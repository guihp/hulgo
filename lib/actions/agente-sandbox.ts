"use server";

import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import {
  openaiDescribeImage,
  openaiExtractDocumentText,
  openaiTranscribeAudio,
} from "@/lib/openai/sandbox";
import {
  chamarWebhookTesteIA,
  type TesteIAHistoricoTurn,
  type TesteIATipo,
  type TesteIAWebhookPayload,
} from "@/lib/n8n";
import { limparSandboxAntigo } from "@/lib/agente/sandbox-cleanup";

const MAX_MEDIA_BYTES = 12 * 1024 * 1024; // 12 MB
const HISTORICO_MAX_TURNS = 20;

export { limparSandboxAntigo };

export type SandboxVersao = "rascunho" | "publicada";

export type SandboxMediaKind = "image" | "audio" | "documento";

export type SandboxMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  media_kind: SandboxMediaKind | null;
  media_url: string | null;
  media_mime: string | null;
  transcript: string | null;
  created_at: string;
};

export type SandboxSessionResult = {
  sessaoId: string;
  messages: SandboxMessage[];
};

export type SandboxSendResult = {
  sessaoId: string;
  userMessage: SandboxMessage;
  assistantMessage: SandboxMessage;
  meta: {
    model: string;
    encaminhar: boolean;
    proximoDoc: string | null;
  };
};

async function requireAdvogado() {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (user.papel !== "advogado") throw new Error("Sem permissão");
  return user;
}

function base64ToBuffer(raw: string): Buffer {
  const cleaned = raw.includes(",") ? raw.split(",", 2)[1]! : raw;
  return Buffer.from(cleaned, "base64");
}

function mapRow(row: {
  id: string;
  role: string;
  content: string;
  media_kind: string | null;
  media_url: string | null;
  media_mime: string | null;
  transcript: string | null;
  created_at: string;
}): SandboxMessage {
  const kind =
    row.media_kind === "image" ||
    row.media_kind === "audio" ||
    row.media_kind === "documento"
      ? row.media_kind
      : null;
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content ?? "",
    media_kind: kind,
    media_url: row.media_url,
    media_mime: row.media_mime,
    transcript: row.transcript,
    created_at: row.created_at,
  };
}

async function loadAgentePersona(versao: SandboxVersao): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_agente_config")
    .select("persona, persona_rascunho")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return "";

  if (versao === "publicada") {
    return (data.persona ?? "").trim();
  }

  const personaRascunho = (data.persona_rascunho ?? "").trim();
  return personaRascunho || (data.persona ?? "").trim();
}

function buildSystemPrompt(input: {
  persona: string;
  escritorioNome: string;
  tipoCasoLabel: string | null;
  documentos: string[];
}): string {
  const docs =
    input.documentos.length > 0
      ? input.documentos.map((d) => `• ${d}`).join("\n")
      : "• (checklist não configurado para este tipo)";

  const parts = [
    input.persona ||
      `Você é a assistente de atendimento do escritório ${input.escritorioNome || "Boueres e Fonteles Advogados"}. Seja clara, empática e objetiva.`,
    "",
    "---",
    "Contexto deste sandbox de teste (não é conversa real com cliente):",
    `- Escritório: ${input.escritorioNome || "—"}`,
    `- Tipo de caso simulado: ${input.tipoCasoLabel || "não definido"}`,
    "- Documentos típicos deste tipo:",
    docs,
    "",
    "Responda sempre como o agente de WhatsApp falaria com o cliente.",
    "Não invente valores de benefício nem prazos judiciais definitivos.",
    "Se o cliente pedir advogado/humano, indique que vai encaminhar.",
  ];

  return parts.join("\n");
}

async function listMessages(
  sessaoId: string
): Promise<SandboxMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_agente_sandbox_mensagens")
    .select(
      "id, role, content, media_kind, media_url, media_mime, transcript, created_at"
    )
    .eq("sessao_id", sessaoId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

function buildHistorico(
  messages: SandboxMessage[],
  excludeId?: string
): TesteIAHistoricoTurn[] {
  const turns: TesteIAHistoricoTurn[] = [];
  for (const m of messages) {
    if (excludeId && m.id === excludeId) continue;
    let content = m.content;
    if (m.media_kind === "audio" && m.transcript) {
      content = m.content.includes(m.transcript)
        ? m.content
        : `${m.content}\n(Transcrição: ${m.transcript})`;
    }
    turns.push({ role: m.role, content });
  }
  if (turns.length <= HISTORICO_MAX_TURNS) return turns;
  return turns.slice(-HISTORICO_MAX_TURNS);
}

async function deleteSessionMedia(sessaoId: string, userId: string) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("app_agente_sandbox_mensagens")
    .select("media_path")
    .eq("sessao_id", sessaoId)
    .not("media_path", "is", null);

  const paths = (rows ?? [])
    .map((r) => r.media_path)
    .filter((p): p is string => Boolean(p));

  if (paths.length) {
    await supabase.storage.from("mensagens-media").remove(paths);
  }

  void userId;
}

export async function iniciarSessaoSandbox(input: {
  versao: SandboxVersao;
  tipoCasoId?: string | null;
  tipoCasoLabel?: string | null;
  documentos?: string[];
  escritorioNome?: string;
}): Promise<SandboxSessionResult> {
  const user = await requireAdvogado();
  const supabase = await createClient();

  try {
    await limparSandboxAntigo();
  } catch {
    /* cron is primary */
  }

  const { data: sessao, error } = await supabase
    .from("app_agente_sandbox_sessoes")
    .insert({
      user_id: user.id,
      versao: input.versao,
      tipo_caso_id: input.tipoCasoId || null,
      tipo_caso_label: input.tipoCasoLabel || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Empty thread on start — first reply comes from n8n after the user sends.
  return { sessaoId: sessao.id, messages: [] };
}

export async function reiniciarSessaoSandbox(input: {
  sessaoId?: string | null;
  versao: SandboxVersao;
  tipoCasoId?: string | null;
  tipoCasoLabel?: string | null;
  documentos?: string[];
  escritorioNome?: string;
}): Promise<SandboxSessionResult> {
  const user = await requireAdvogado();
  const supabase = await createClient();

  if (input.sessaoId) {
    const { data: existing } = await supabase
      .from("app_agente_sandbox_sessoes")
      .select("id, user_id")
      .eq("id", input.sessaoId)
      .maybeSingle();

    if (existing && existing.user_id === user.id) {
      await deleteSessionMedia(existing.id, user.id);
      await supabase
        .from("app_agente_sandbox_sessoes")
        .delete()
        .eq("id", existing.id);
    }
  }

  return iniciarSessaoSandbox({
    versao: input.versao,
    tipoCasoId: input.tipoCasoId,
    tipoCasoLabel: input.tipoCasoLabel,
    documentos: input.documentos,
    escritorioNome: input.escritorioNome,
  });
}

export async function enviarMensagemSandbox(input: {
  sessaoId: string;
  text?: string;
  media?: {
    kind: SandboxMediaKind;
    base64: string;
    mimeType: string;
    fileName: string;
  } | null;
  escritorioNome?: string;
  documentos?: string[];
}): Promise<SandboxSendResult> {
  const user = await requireAdvogado();
  const supabase = await createClient();

  const text = (input.text ?? "").trim();
  const media = input.media ?? null;
  if (!text && !media) {
    throw new Error("Envie texto, imagem, áudio ou documento");
  }

  const { data: sessao, error: sessErr } = await supabase
    .from("app_agente_sandbox_sessoes")
    .select("id, user_id, versao, tipo_caso_label")
    .eq("id", input.sessaoId)
    .maybeSingle();
  if (sessErr) throw new Error(sessErr.message);
  if (!sessao || sessao.user_id !== user.id) {
    throw new Error("Sessão não encontrada");
  }

  const versao = (
    sessao.versao === "publicada" ? "publicada" : "rascunho"
  ) as SandboxVersao;
  const persona = await loadAgentePersona(versao);

  let mediaPath: string | null = null;
  let mediaUrl: string | null = null;
  let mediaMime: string | null = null;
  let mediaKind: SandboxMediaKind | null = null;
  let transcript: string | null = null;
  let audioTranscrito: string | null = null;
  let imagemDescricao: string | null = null;
  let documentoTranscrito: string | null = null;
  let tipo: TesteIATipo = "texto";

  if (media) {
    const mediaBytes = base64ToBuffer(media.base64);
    if (mediaBytes.length > MAX_MEDIA_BYTES) {
      throw new Error("Arquivo maior que 12 MB");
    }
    mediaKind = media.kind;
    mediaMime = media.mimeType || "application/octet-stream";
    const ext = media.fileName.includes(".")
      ? media.fileName.split(".").pop()!.toLowerCase()
      : media.kind === "image"
        ? "jpg"
        : media.kind === "audio"
          ? "webm"
          : "bin";
    mediaPath = `sandbox/${user.id}/${sessao.id}/${randomUUID()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("mensagens-media")
      .upload(mediaPath, mediaBytes, {
        contentType: mediaMime,
        upsert: false,
      });
    if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);

    const { data: pub } = supabase.storage
      .from("mensagens-media")
      .getPublicUrl(mediaPath);
    mediaUrl = pub.publicUrl;

    if (media.kind === "image") {
      tipo = "imagem";
      const dataUrl = `data:${mediaMime};base64,${mediaBytes.toString("base64")}`;
      imagemDescricao = await openaiDescribeImage({
        dataUrl,
        caption: text || undefined,
      });
      transcript = imagemDescricao;
    } else if (media.kind === "audio") {
      tipo = "audio";
      audioTranscrito = await openaiTranscribeAudio({
        bytes: mediaBytes,
        fileName: media.fileName || `audio.${ext}`,
        mimeType: mediaMime,
      });
      transcript = audioTranscrito;
    } else {
      tipo = "documento";
      documentoTranscrito = await openaiExtractDocumentText({
        bytes: mediaBytes,
        fileName: media.fileName || `documento.${ext}`,
        mimeType: mediaMime,
      });
      transcript = documentoTranscrito;
    }
  }

  const userDisplayContent =
    text ||
    (mediaKind === "audio"
      ? `[Áudio] ${audioTranscrito ?? ""}`
      : mediaKind === "image"
        ? "[Imagem enviada]"
        : mediaKind === "documento"
          ? `[Documento] ${media?.fileName ?? ""}`
          : "");

  const { data: userRow, error: userInsErr } = await supabase
    .from("app_agente_sandbox_mensagens")
    .insert({
      sessao_id: sessao.id,
      role: "user",
      content: userDisplayContent,
      media_kind: mediaKind,
      media_path: mediaPath,
      media_url: mediaUrl,
      media_mime: mediaMime,
      transcript,
    })
    .select(
      "id, role, content, media_kind, media_url, media_mime, transcript, created_at"
    )
    .single();
  if (userInsErr) throw new Error(userInsErr.message);

  const history = await listMessages(sessao.id);
  const systemPrompt = buildSystemPrompt({
    persona,
    escritorioNome: input.escritorioNome ?? "",
    tipoCasoLabel: sessao.tipo_caso_label,
    documentos: input.documentos ?? [],
  });

  // What the agent should answer to (user text; media details go in typed fields)
  let mensagemParaAgente = text;
  if (!mensagemParaAgente) {
    if (audioTranscrito) mensagemParaAgente = audioTranscrito;
    else if (imagemDescricao) mensagemParaAgente = "O cliente enviou uma imagem.";
    else if (documentoTranscrito) {
      mensagemParaAgente = `O cliente enviou um documento (${media?.fileName ?? "arquivo"}).`;
    }
  }

  const payload: TesteIAWebhookPayload = {
    prompt: systemPrompt,
    mensagem: mensagemParaAgente,
    tipo,
    audio_transcrito: audioTranscrito,
    imagem_descricao: imagemDescricao,
    documento_transcrito: documentoTranscrito,
    historico: buildHistorico(history, userRow.id),
    sessao_id: sessao.id,
    versao_prompt: versao,
    tipo_caso: sessao.tipo_caso_label ?? "",
  };

  const { reply, model } = await chamarWebhookTesteIA(payload);

  const lower = reply.toLowerCase();
  const encaminhar =
    lower.includes("encaminh") ||
    lower.includes("advogado") ||
    lower.includes("equipe");
  const proximoDoc = input.documentos?.[0] ?? null;

  const { data: assistantRow, error: asstErr } = await supabase
    .from("app_agente_sandbox_mensagens")
    .insert({
      sessao_id: sessao.id,
      role: "assistant",
      content: reply,
      meta: {
        model,
        encaminhar,
        proximoDoc,
        tipo,
      },
    })
    .select(
      "id, role, content, media_kind, media_url, media_mime, transcript, created_at"
    )
    .single();
  if (asstErr) throw new Error(asstErr.message);

  await supabase
    .from("app_agente_sandbox_sessoes")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", sessao.id);

  return {
    sessaoId: sessao.id,
    userMessage: mapRow(userRow),
    assistantMessage: mapRow(assistantRow),
    meta: {
      model,
      encaminhar,
      proximoDoc,
    },
  };
}
