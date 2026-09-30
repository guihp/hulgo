"use server";

import { getAppUser } from "@/lib/actions/auth";
import {
  formatPendingAnexoBlock,
  parseAssistentePendingAnexo,
  prepareAssistenteAnexo,
} from "@/lib/assistente/media";
import { buildAssistenteSystemPrompt } from "@/lib/assistente/prompt";
import { runAssistenteToolLoop } from "@/lib/assistente/openai";
import type {
  AssistenteAnexoInput,
  AssistenteAnexoStored,
  AssistenteConfirmResult,
  AssistenteMessage,
  AssistentePendingAnexo,
  AssistenteSendResult,
  AssistenteSessionResult,
  AssistenteSessaoListItem,
  AssistenteToolTraceItem,
} from "@/lib/assistente/types";
import {
  applyPendingAnexoToWriteArgs,
  executeAssistenteWriteTool,
  isWriteTool,
  resolveWriteArgs,
} from "@/lib/assistente/write-tools";
import { getOpenAIChatModel } from "@/lib/openai/sandbox";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

const HISTORICO_MAX = 24;
const SESSOES_LIST_MAX = 30;

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

async function requireAppUser() {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  return user;
}

function mapAnexos(raw: unknown): AssistenteAnexoStored[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is AssistenteAnexoStored =>
      !!a &&
      typeof a === "object" &&
      typeof (a as AssistenteAnexoStored).fileName === "string" &&
      typeof (a as AssistenteAnexoStored).mimeType === "string"
  );
}

function mapMessage(row: {
  id: string;
  role: string;
  content: string;
  tool_trace: unknown;
  anexos?: unknown;
  created_at: string;
}): AssistenteMessage | null {
  if (row.role !== "user" && row.role !== "assistant") return null;
  const trace = Array.isArray(row.tool_trace)
    ? (row.tool_trace as AssistenteToolTraceItem[])
    : [];
  return {
    id: row.id,
    role: row.role,
    content: row.content ?? "",
    tool_trace: trace,
    anexos: mapAnexos(row.anexos),
    created_at: row.created_at,
  };
}

/** Decisions live only in the card (tool_trace), so the model needs them spelled out. */
function historyContent(m: AssistenteMessage): string {
  if (m.role !== "assistant") return m.content;
  const notes = m.tool_trace.flatMap((t) => {
    const label = t.result.confirmationLabel || t.name;
    if (t.confirmationStatus === "confirmed") {
      return [
        t.result.ok
          ? `[Usuário confirmou "${label}". Resultado: ${t.result.summary}]`
          : `[Usuário confirmou "${label}", mas falhou: ${t.result.summary}]`,
      ];
    }
    if (t.confirmationStatus === "cancelled") {
      return [`[Usuário cancelou "${label}".]`];
    }
    return [];
  });
  return notes.length ? [m.content, ...notes].join("\n") : m.content;
}

async function loadAssistantMessage(
  messageId: string,
  sessaoId: string
): Promise<AssistenteMessage> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_assistente_mensagens")
    .select("id, role, content, tool_trace, anexos, created_at")
    .eq("id", messageId)
    .eq("sessao_id", sessaoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const mapped = data ? mapMessage(data) : null;
  if (!mapped || mapped.role !== "assistant") {
    throw new Error("Mensagem não encontrada");
  }
  return mapped;
}

async function updateMessageToolTrace(
  messageId: string,
  toolTrace: AssistenteToolTraceItem[]
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_assistente_mensagens")
    .update({ tool_trace: asJson(toolTrace) })
    .eq("id", messageId);
  if (error) throw new Error(error.message);
}

async function listMessages(sessaoId: string): Promise<AssistenteMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_assistente_mensagens")
    .select("id, role, content, tool_trace, anexos, created_at")
    .eq("sessao_id", sessaoId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map(mapMessage)
    .filter((m): m is AssistenteMessage => m != null);
}

async function assertSessaoOwn(sessaoId: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_assistente_sessoes")
    .select("id, user_id, pending_anexo")
    .eq("id", sessaoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.user_id !== userId) {
    throw new Error("Sessão não encontrada");
  }
  return data;
}

async function touchSessao(sessaoId: string) {
  const supabase = await createClient();
  await supabase
    .from("app_assistente_sessoes")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", sessaoId);
}

async function setSessaoPendingAnexo(
  sessaoId: string,
  pending: AssistentePendingAnexo | null
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_assistente_sessoes")
    .update({
      pending_anexo: pending ? asJson(pending) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessaoId);
  if (error) throw new Error(error.message);
}

async function insertAudit(input: {
  sessaoId: string;
  userId: string;
  item: AssistenteToolTraceItem;
  confirmedBy?: string | null;
}) {
  const supabase = await createClient();
  await supabase.from("app_assistente_auditoria").insert({
    sessao_id: input.sessaoId,
    user_id: input.userId,
    tool: input.item.name,
    args: asJson(input.item.args),
    result: asJson(input.item.result),
    confirmed_by: input.confirmedBy ?? null,
  });
}

/** Starts a new assistant session (or reuses most recent empty one). */
export async function iniciarSessaoAssistente(): Promise<AssistenteSessionResult> {
  const user = await requireAppUser();
  const supabase = await createClient();
  const model = getOpenAIChatModel();

  const reused = await findEmptySessaoId(user.id);
  if (reused) {
    await pruneEmptySessoes(user.id, reused);
    return { sessaoId: reused, messages: [], model };
  }

  const { data, error } = await supabase
    .from("app_assistente_sessoes")
    .insert({ user_id: user.id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await pruneEmptySessoes(user.id, data.id);
  return { sessaoId: data.id, messages: [], model };
}

/** Nova conversa: reuses an empty session when possible (avoids "vazia" clutter). */
export async function novaSessaoAssistente(): Promise<AssistenteSessionResult> {
  const user = await requireAppUser();
  const supabase = await createClient();
  const model = getOpenAIChatModel();

  const reused = await findEmptySessaoId(user.id);

  if (reused) {
    await pruneEmptySessoes(user.id, reused);
    await touchSessao(reused);
    return { sessaoId: reused, messages: [], model };
  }

  const { data, error } = await supabase
    .from("app_assistente_sessoes")
    .insert({ user_id: user.id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await pruneEmptySessoes(user.id, data.id);
  return { sessaoId: data.id, messages: [], model };
}

async function findEmptySessaoId(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: sessoes } = await supabase
    .from("app_assistente_sessoes")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (!sessoes?.length) return null;

  for (const s of sessoes) {
    const { count } = await supabase
      .from("app_assistente_mensagens")
      .select("id", { count: "exact", head: true })
      .eq("sessao_id", s.id)
      .in("role", ["user", "assistant"]);
    if ((count ?? 0) === 0) return s.id;
  }
  return null;
}

/** Deletes empty sessions except keepId (history should not list "vazia"). */
async function pruneEmptySessoes(userId: string, keepId: string) {
  const supabase = await createClient();
  const { data: sessoes } = await supabase
    .from("app_assistente_sessoes")
    .select("id")
    .eq("user_id", userId)
    .neq("id", keepId)
    .limit(50);
  if (!sessoes?.length) return;

  const toDelete: string[] = [];
  for (const s of sessoes) {
    const { count } = await supabase
      .from("app_assistente_mensagens")
      .select("id", { count: "exact", head: true })
      .eq("sessao_id", s.id)
      .in("role", ["user", "assistant"]);
    if ((count ?? 0) === 0) toDelete.push(s.id);
  }
  if (!toDelete.length) return;

  await supabase.from("app_assistente_sessoes").delete().in("id", toDelete);
}

/** Lists recent sessions for the current user (newest first). */
export async function listarSessoesAssistente(): Promise<
  AssistenteSessaoListItem[]
> {
  const user = await requireAppUser();
  const supabase = await createClient();

  const { data: sessoes, error } = await supabase
    .from("app_assistente_sessoes")
    .select("id, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(SESSOES_LIST_MAX);
  if (error) throw new Error(error.message);
  if (!sessoes?.length) return [];

  const ids = sessoes.map((s) => s.id);
  const { data: msgs, error: msgErr } = await supabase
    .from("app_assistente_mensagens")
    .select("sessao_id, role, content, created_at")
    .in("sessao_id", ids)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true });
  if (msgErr) throw new Error(msgErr.message);

  const bySessao = new Map<
    string,
    { count: number; firstUser: string | null; lastContent: string | null }
  >();
  for (const id of ids) {
    bySessao.set(id, { count: 0, firstUser: null, lastContent: null });
  }
  for (const m of msgs ?? []) {
    const bucket = bySessao.get(m.sessao_id);
    if (!bucket) continue;
    bucket.count += 1;
    const text = (m.content ?? "").trim();
    if (m.role === "user" && !bucket.firstUser && text) {
      bucket.firstUser = text;
    }
    if (text) bucket.lastContent = text;
  }

  const listed = sessoes
    .map((s) => {
      const info = bySessao.get(s.id);
      const raw = info?.firstUser || info?.lastContent || "Nova conversa";
      const preview =
        raw.length > 72 ? `${raw.slice(0, 69).trimEnd()}…` : raw;
      return {
        id: s.id,
        created_at: s.created_at,
        updated_at: s.updated_at,
        preview,
        message_count: info?.count ?? 0,
      };
    })
    // Hide empty shells — they are not real conversations.
    .filter((s) => s.message_count > 0);

  return listed;
}

/** Opens an existing session owned by the current user. */
export async function abrirSessaoAssistente(
  sessaoId: string
): Promise<AssistenteSessionResult> {
  const user = await requireAppUser();
  await assertSessaoOwn(sessaoId, user.id);
  const messages = await listMessages(sessaoId);
  return {
    sessaoId,
    messages,
    model: getOpenAIChatModel(),
  };
}

/** Clears messages of a session or creates a fresh one. */
export async function reiniciarSessaoAssistente(input?: {
  sessaoId?: string | null;
}): Promise<AssistenteSessionResult> {
  const user = await requireAppUser();
  const supabase = await createClient();
  const model = getOpenAIChatModel();

  if (input?.sessaoId) {
    await assertSessaoOwn(input.sessaoId, user.id);
    const { error: delErr } = await supabase
      .from("app_assistente_mensagens")
      .delete()
      .eq("sessao_id", input.sessaoId);
    if (delErr) throw new Error(delErr.message);
    await setSessaoPendingAnexo(input.sessaoId, null);
    return { sessaoId: input.sessaoId, messages: [], model };
  }

  return iniciarSessaoAssistente();
}

export async function enviarMensagemAssistente(input: {
  sessaoId: string;
  content: string;
  /** Optional attachment from the drawer (image/video/doc). */
  anexo?: AssistenteAnexoInput | null;
}): Promise<AssistenteSendResult> {
  const user = await requireAppUser();
  const content = input.content.trim();
  const anexo = input.anexo ?? null;
  if (!content && !anexo) throw new Error("Mensagem vazia");
  if (content.length > 8000) throw new Error("Mensagem muito longa");
  if (anexo && anexo.modo !== "interpretar" && anexo.modo !== "somente_salvar") {
    throw new Error("Escolha Interpretar ou Só salvar para o anexo");
  }

  const sessao = await assertSessaoOwn(input.sessaoId, user.id);
  const supabase = await createClient();

  let displayContent = content;
  let modelUserMessage = content;
  let storedAnexos: AssistenteAnexoStored[] = [];
  let pendingAnexo = parseAssistentePendingAnexo(sessao.pending_anexo);

  if (anexo) {
    const prepared = await prepareAssistenteAnexo({
      anexo,
      userId: user.id,
      sessaoId: input.sessaoId,
      userText: content,
      supabase,
    });
    displayContent = prepared.displayContent;
    modelUserMessage = prepared.modelContext;
    storedAnexos = [prepared.stored];
    pendingAnexo = prepared.pending;
    await setSessaoPendingAnexo(input.sessaoId, pendingAnexo);
  }

  // Re-inject pending media on follow-up turns (history only has display text).
  if (!anexo && pendingAnexo) {
    const pendingBlock = formatPendingAnexoBlock(pendingAnexo);
    modelUserMessage = [
      content || "(sem texto adicional)",
      "",
      pendingBlock,
    ].join("\n");
  }

  const historyRows = await listMessages(input.sessaoId);
  const history = historyRows
    .slice(-HISTORICO_MAX)
    .map((m) => ({ role: m.role, content: historyContent(m) }));

  const { data: userRow, error: userErr } = await supabase
    .from("app_assistente_mensagens")
    .insert({
      sessao_id: input.sessaoId,
      role: "user",
      content: displayContent,
      tool_trace: [],
      anexos: asJson(storedAnexos),
    })
    .select("id, role, content, tool_trace, anexos, created_at")
    .single();
  if (userErr) throw new Error(userErr.message);

  const userMessage = mapMessage(userRow);
  if (!userMessage) throw new Error("Falha ao gravar mensagem");

  const systemPrompt = buildAssistenteSystemPrompt({
    userNome: user.nome,
    now: new Date(),
    pendingAnexoBlock: pendingAnexo
      ? formatPendingAnexoBlock(pendingAnexo)
      : null,
  });

  let loopContent: string;
  let loopTrace: AssistenteToolTraceItem[] = [];
  let loopModel = getOpenAIChatModel();

  try {
    const loop = await runAssistenteToolLoop({
      systemPrompt,
      history,
      userMessage: modelUserMessage,
      pendingAnexo,
      onTool: async (item) => {
        await insertAudit({
          sessaoId: input.sessaoId,
          userId: user.id,
          item,
        });
      },
    });
    loopContent = loop.content;
    loopTrace = loop.toolTrace;
    loopModel = loop.model;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[assistente] runAssistenteToolLoop:", errMsg);
    // Não relança: em produção o throw da Server Action vira digest de RSC.
    loopContent =
      "Não consegui responder agora. " +
      (/api key|OPENAI|401|Unauthorized/i.test(errMsg)
        ? "Verifique OPENAI_API_KEY no ambiente (Coolify)."
        : /model|not found|404/i.test(errMsg)
          ? `Modelo "${loopModel}" indisponível — confira OPENAI_MODEL.`
          : errMsg.slice(0, 280));
  }

  const { data: asstRow, error: asstErr } = await supabase
    .from("app_assistente_mensagens")
    .insert({
      sessao_id: input.sessaoId,
      role: "assistant",
      content: loopContent,
      tool_trace: asJson(loopTrace),
    })
    .select("id, role, content, tool_trace, anexos, created_at")
    .single();
  if (asstErr) throw new Error(asstErr.message);

  const assistantMessage = mapMessage(asstRow);
  if (!assistantMessage) throw new Error("Falha ao gravar resposta");

  await touchSessao(input.sessaoId);

  return {
    sessaoId: input.sessaoId,
    userMessage,
    assistantMessage,
    model: loopModel,
  };
}

/**
 * Confirms a pending write tool from an assistant message, executes it,
 * audits with confirmed_by, and appends a follow-up assistant reply.
 */
export async function confirmarAcaoAssistente(input: {
  sessaoId: string;
  messageId: string;
  confirmationId: string;
}): Promise<AssistenteConfirmResult> {
  const user = await requireAppUser();
  const sessao = await assertSessaoOwn(input.sessaoId, user.id);
  const pendingAnexo = parseAssistentePendingAnexo(sessao.pending_anexo);

  const message = await loadAssistantMessage(input.messageId, input.sessaoId);
  const idx = message.tool_trace.findIndex(
    (t) =>
      t.confirmationId === input.confirmationId &&
      t.confirmationStatus === "pending"
  );
  if (idx < 0) {
    throw new Error("Ação não encontrada ou já decidida");
  }

  const pending = message.tool_trace[idx];
  if (!isWriteTool(pending.name)) {
    throw new Error("Ferramenta não suportada para confirmação");
  }

  let writeArgs = resolveWriteArgs(pending);
  writeArgs = applyPendingAnexoToWriteArgs(
    pending.name,
    writeArgs,
    pendingAnexo
  );
  const result = await executeAssistenteWriteTool(pending.name, writeArgs);

  // Clear session pending media after successful attach.
  if (result.ok && pending.name === "anexar_documento_ficha") {
    await setSessaoPendingAnexo(input.sessaoId, null);
  }

  const updatedTrace = message.tool_trace.map((t, i) =>
    i === idx
      ? {
          ...t,
          confirmationStatus: "confirmed" as const,
          result: {
            ...result,
            requiresConfirmation: false,
            confirmationId: t.confirmationId,
            confirmationLabel: t.result.confirmationLabel,
          },
        }
      : t
  );

  await updateMessageToolTrace(input.messageId, updatedTrace);

  const executedItem: AssistenteToolTraceItem = {
    name: pending.name,
    args: writeArgs,
    result,
    confirmationId: pending.confirmationId,
    confirmationStatus: "confirmed",
  };

  await insertAudit({
    sessaoId: input.sessaoId,
    userId: user.id,
    item: executedItem,
    confirmedBy: user.id,
  });

  // The updated card already shows the result; a follow-up only when it adds a next step.
  let followUpMessage: AssistenteMessage | null = null;
  if (!result.ok && /cpf inválido/i.test(result.summary)) {
    const supabase = await createClient();
    const { data: followRow, error: followErr } = await supabase
      .from("app_assistente_mensagens")
      .insert({
        sessao_id: input.sessaoId,
        role: "assistant",
        content:
          "Não consegui criar: o CPF informado é inválido (dígitos verificadores). Pode me enviar o CPF correto para eu tentar de novo?",
        tool_trace: [],
      })
      .select("id, role, content, tool_trace, anexos, created_at")
      .single();
    if (followErr) throw new Error(followErr.message);
    followUpMessage = mapMessage(followRow);
  }

  await touchSessao(input.sessaoId);

  return {
    sessaoId: input.sessaoId,
    updatedMessage: { ...message, tool_trace: updatedTrace },
    followUpMessage,
  };
}

/** Cancels a pending write proposal without executing. */
export async function cancelarAcaoAssistente(input: {
  sessaoId: string;
  messageId: string;
  confirmationId: string;
}): Promise<AssistenteConfirmResult> {
  const user = await requireAppUser();
  await assertSessaoOwn(input.sessaoId, user.id);

  const message = await loadAssistantMessage(input.messageId, input.sessaoId);
  const idx = message.tool_trace.findIndex(
    (t) =>
      t.confirmationId === input.confirmationId &&
      t.confirmationStatus === "pending"
  );
  if (idx < 0) {
    throw new Error("Ação não encontrada ou já decidida");
  }

  const pending = message.tool_trace[idx];
  const cancelledResult = {
    ok: false as const,
    summary: "Cancelado pelo usuário.",
    requiresConfirmation: false,
    confirmationId: pending.confirmationId,
    confirmationLabel: pending.result.confirmationLabel,
  };

  const updatedTrace = message.tool_trace.map((t, i) =>
    i === idx
      ? {
          ...t,
          confirmationStatus: "cancelled" as const,
          result: cancelledResult,
        }
      : t
  );

  await updateMessageToolTrace(input.messageId, updatedTrace);

  const cancelledItem: AssistenteToolTraceItem = {
    name: pending.name,
    args: pending.args,
    result: cancelledResult,
    confirmationId: pending.confirmationId,
    confirmationStatus: "cancelled",
  };

  await insertAudit({
    sessaoId: input.sessaoId,
    userId: user.id,
    item: cancelledItem,
    confirmedBy: user.id,
  });

  await touchSessao(input.sessaoId);

  return {
    sessaoId: input.sessaoId,
    updatedMessage: { ...message, tool_trace: updatedTrace },
    followUpMessage: null,
  };
}
