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
  AssistenteToolTraceItem,
} from "@/lib/assistente/types";
import {
  applyPendingAnexoToWriteArgs,
  executeAssistenteWriteTool,
  isWriteTool,
  resolveWriteArgs,
} from "@/lib/assistente/write-tools";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

const HISTORICO_MAX = 24;

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

  const { data: recent } = await supabase
    .from("app_assistente_sessoes")
    .select("id")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent?.id) {
    const messages = await listMessages(recent.id);
    if (messages.length === 0) {
      return { sessaoId: recent.id, messages: [] };
    }
  }

  const { data, error } = await supabase
    .from("app_assistente_sessoes")
    .insert({ user_id: user.id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  return { sessaoId: data.id, messages: [] };
}

/** Clears messages of a session or creates a fresh one. */
export async function reiniciarSessaoAssistente(input?: {
  sessaoId?: string | null;
}): Promise<AssistenteSessionResult> {
  const user = await requireAppUser();
  const supabase = await createClient();

  if (input?.sessaoId) {
    await assertSessaoOwn(input.sessaoId, user.id);
    const { error: delErr } = await supabase
      .from("app_assistente_mensagens")
      .delete()
      .eq("sessao_id", input.sessaoId);
    if (delErr) throw new Error(delErr.message);
    await setSessaoPendingAnexo(input.sessaoId, null);
    return { sessaoId: input.sessaoId, messages: [] };
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
    .map((m) => ({ role: m.role, content: m.content }));

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

  const { data: asstRow, error: asstErr } = await supabase
    .from("app_assistente_mensagens")
    .insert({
      sessao_id: input.sessaoId,
      role: "assistant",
      content: loop.content,
      tool_trace: asJson(loop.toolTrace),
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
    model: loop.model,
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

  const supabase = await createClient();
  const content = result.ok
    ? `Confirmado: ${result.summary}`
    : `Falha ao executar: ${result.summary}`;

  const { data: followRow, error: followErr } = await supabase
    .from("app_assistente_mensagens")
    .insert({
      sessao_id: input.sessaoId,
      role: "assistant",
      content,
      tool_trace: asJson([executedItem]),
    })
    .select("id, role, content, tool_trace, anexos, created_at")
    .single();
  if (followErr) throw new Error(followErr.message);

  const followUpMessage = mapMessage(followRow);
  if (!followUpMessage) throw new Error("Falha ao gravar resultado");

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

  const supabase = await createClient();
  const label = pending.result.confirmationLabel || pending.name;
  const { data: followRow, error: followErr } = await supabase
    .from("app_assistente_mensagens")
    .insert({
      sessao_id: input.sessaoId,
      role: "assistant",
      content: `Cancelado: ${label}.`,
      tool_trace: asJson([cancelledItem]),
    })
    .select("id, role, content, tool_trace, anexos, created_at")
    .single();
  if (followErr) throw new Error(followErr.message);

  const followUpMessage = mapMessage(followRow);
  if (!followUpMessage) throw new Error("Falha ao gravar cancelamento");

  await touchSessao(input.sessaoId);

  return {
    sessaoId: input.sessaoId,
    updatedMessage: { ...message, tool_trace: updatedTrace },
    followUpMessage,
  };
}
