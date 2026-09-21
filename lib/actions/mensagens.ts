"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getAppUser } from "@/lib/actions/auth";
import {
  sendContact,
  sendLocation,
  sendMedia,
  sendSticker,
  sendText,
} from "@/lib/evogo/client";
import { getWhatsAppInstancia } from "@/lib/config/app-config";
import { controlarIA } from "@/lib/n8n";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json, Tables } from "@/types/database";

const EVOGO_INSTANCE_FALLBACK = process.env.EVOGO_INSTANCE_NAME ?? "";

export type EvoGoMediaType = "image" | "audio" | "video" | "document";
type Mensagem = Tables<"mensagens">;

export type EnviarMensagemInput = {
  phone: string;
  contactNorm: string;
  instancia?: string;
  /**
   * true (padrão): pausa a IA para este cliente via webhook n8n —
   * o advogado assumiu a conversa. Passe false quando o próprio
   * fluxo já cuida do estado da IA (ex.: decisão de aprovação).
   */
  pausarIA?: boolean;
} & (
  | { kind: "text"; text: string }
  | {
      kind: "media";
      fileBase64: string;
      fileName: string;
      mimeType: string;
      mediaType: EvoGoMediaType;
      caption?: string;
    }
  | {
      kind: "location";
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    }
  | {
      kind: "sticker";
      stickerUrl?: string;
      fileBase64?: string;
      fileName?: string;
    }
  | {
      kind: "contact";
      fullName: string;
      contactPhone: string;
      organization?: string;
    }
);

export type EnviarMensagemResult = {
  success: true;
  messageId: string;
  rowId: number | null;
  mensagem: Mensagem | null;
  warning?: string;
  iaPausada?: boolean;
};

function normalizePhoneDigits(phone: string): string {
  return phone.replace(/@.*$/, "").replace(/\D/g, "");
}

function extensionFromName(name: string, fallback = "bin"): string {
  const parts = name.split(".");
  if (parts.length < 2) return fallback;
  return parts.pop()!.toLowerCase();
}

function base64ToBuffer(base64: string): Buffer {
  const cleaned = base64.includes(",") ? base64.split(",").pop()! : base64;
  return Buffer.from(cleaned, "base64");
}

function normalizeMimeType(mimeType: string, fileName: string): string {
  const trimmed = mimeType.trim().toLowerCase();
  if (trimmed && trimmed !== "application/octet-stream") return trimmed;
  const ext = extensionFromName(fileName, "");
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    pdf: "application/pdf",
  };
  return map[ext] ?? "application/octet-stream";
}

async function getStorageClient() {
  try {
    return createServiceClient();
  } catch {
    return await createClient();
  }
}

async function uploadToMensagensMedia(
  contactNorm: string,
  fileName: string,
  mimeType: string,
  base64: string,
  prefix = "out"
): Promise<string> {
  const supabase = await getStorageClient();
  const normalizedMime = normalizeMimeType(mimeType, fileName);
  const ext = extensionFromName(fileName, normalizedMime.split("/")[1] ?? "bin");
  const storagePath = `${contactNorm}/${prefix}-${randomUUID()}.${ext}`;
  const buffer = base64ToBuffer(base64);

  const { error } = await supabase.storage
    .from("mensagens-media")
    .upload(storagePath, buffer, {
      contentType: normalizedMime,
      upsert: false,
    });

  if (error) {
    throw new Error(`Falha no upload da mídia: ${error.message}`);
  }

  const { data } = supabase.storage.from("mensagens-media").getPublicUrl(storagePath);
  return data.publicUrl;
}

async function logEvent(
  entidadeId: number | null,
  acao: string,
  payload?: Json,
  usuarioId?: string | null
) {
  const supabase = await createClient();
  await supabase.from("app_log_eventos").insert({
    usuario_id: usuarioId ?? null,
    entidade: "mensagens",
    entidade_id: entidadeId,
    acao,
    payload: payload ?? null,
  });
}

type UpsertMensagemRow = {
  result_id?: number;
  result_contact_norm?: string;
  id?: number;
  contact_norm?: string;
};

async function fetchMensagemById(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rowId: number | null,
  messageId: string
): Promise<Mensagem | null> {
  if (rowId) {
    const { data } = await supabase
      .from("mensagens")
      .select("*")
      .eq("id", rowId)
      .maybeSingle();
    if (data) return data;
  }
  const { data } = await supabase
    .from("mensagens")
    .select("*")
    .eq("mensagem_id", messageId)
    .maybeSingle();
  return data ?? null;
}

async function persistMensagem(params: {
  phone: string;
  messageId: string;
  instancia: string;
  mensageType: string;
  text: string | null;
  conteudoMedia: string | null;
}): Promise<{ rowId: number | null; mensagem: Mensagem | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_mensagem", {
    p_phone: params.phone,
    p_type: "bot",
    p_text: params.text,
    p_mensagem_id: params.messageId,
    p_mensage_type: params.mensageType,
    p_plataforma: "whatsapp",
    p_instancia: params.instancia,
    p_session_id: null,
    p_conteudo_media: params.conteudoMedia,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = (Array.isArray(data) ? data[0] : data) as UpsertMensagemRow | null;
  const rowId = row?.result_id ?? row?.id ?? null;
  const mensagem = await fetchMensagemById(supabase, rowId, params.messageId);

  return { rowId, mensagem };
}

export async function enviarMensagem(
  input: EnviarMensagemInput
): Promise<EnviarMensagemResult> {
  const user = await getAppUser();
  if (!user) {
    throw new Error("Não autenticado");
  }

  const phoneDigits = normalizePhoneDigits(input.phone);
  if (!phoneDigits) {
    throw new Error("Telefone inválido");
  }

  const instancia =
    input.instancia?.trim() ||
    (await getWhatsAppInstancia(input.contactNorm)) ||
    EVOGO_INSTANCE_FALLBACK;

  if (!instancia) {
    throw new Error(
      "Instância WhatsApp não configurada — defina em Configurações"
    );
  }
  let messageId: string;
  let mensageType: string;
  let text: string | null = null;
  let conteudoMedia: string | null = null;

  switch (input.kind) {
    case "text": {
      const body = input.text.trim();
      if (!body) throw new Error("Texto vazio");
      messageId = await sendText(phoneDigits, body);
      mensageType = "text";
      text = body;
      break;
    }
    case "media": {
      const publicUrl = await uploadToMensagensMedia(
        input.contactNorm,
        input.fileName,
        input.mimeType,
        input.fileBase64
      );
      messageId = await sendMedia({
        number: phoneDigits,
        url: publicUrl,
        type: input.mediaType,
        caption: input.caption,
        filename: input.fileName,
      });
      mensageType = input.mediaType;
      text = input.caption?.trim() || null;
      conteudoMedia = publicUrl;
      break;
    }
    case "location": {
      messageId = await sendLocation({
        number: phoneDigits,
        latitude: input.latitude,
        longitude: input.longitude,
        name: input.name,
        address: input.address,
      });
      mensageType = "location";
      text = JSON.stringify({
        name: input.name?.trim() || null,
        address: input.address?.trim() || null,
        lat: input.latitude,
        lng: input.longitude,
      });
      break;
    }
    case "sticker": {
      let stickerUrl = input.stickerUrl?.trim() || null;
      if (!stickerUrl) {
        if (!input.fileBase64 || !input.fileName) {
          throw new Error("Informe um arquivo .webp ou URL do sticker");
        }
        stickerUrl = await uploadToMensagensMedia(
          input.contactNorm,
          input.fileName,
          "image/webp",
          input.fileBase64,
          "sticker"
        );
      }
      messageId = await sendSticker(phoneDigits, stickerUrl);
      mensageType = "sticker";
      conteudoMedia = stickerUrl;
      break;
    }
    case "contact": {
      const contactPhone = normalizePhoneDigits(input.contactPhone);
      if (!input.fullName.trim() || !contactPhone) {
        throw new Error("Nome e telefone do contato são obrigatórios");
      }
      messageId = await sendContact({
        number: phoneDigits,
        vcard: {
          fullName: input.fullName,
          phone: contactPhone,
          organization: input.organization,
        },
      });
      mensageType = "contact";
      text = JSON.stringify({
        fullName: input.fullName.trim(),
        phone: contactPhone,
        organization: input.organization?.trim() || null,
      });
      break;
    }
    default:
      throw new Error("Tipo de mensagem não suportado");
  }

  let rowId: number | null = null;
  let mensagem: Mensagem | null = null;
  let warning: string | undefined;

  try {
    const persisted = await persistMensagem({
      phone: phoneDigits,
      messageId,
      instancia,
      mensageType,
      text,
      conteudoMedia,
    });
    rowId = persisted.rowId;
    mensagem = persisted.mensagem;
    revalidatePath("/atendimentos");
  } catch (err) {
    warning =
      err instanceof Error
        ? `Mensagem enviada, mas falhou ao salvar no banco: ${err.message}`
        : "Mensagem enviada, mas falhou ao salvar no banco";
  }

  // Advogado assumiu a conversa → pausa a IA para este cliente (block no Redis via n8n)
  let iaPausada = false;
  if (input.pausarIA !== false) {
    const controle = await controlarIA("pausar", phoneDigits, instancia);
    iaPausada = controle.ok;
    if (controle.configured && !controle.ok && !warning) {
      warning =
        "Mensagem enviada, mas o n8n não confirmou a pausa da IA — ela pode responder o cliente junto com você.";
    }
  }

  await logEvent(
    rowId,
    "enviar",
    {
      kind: input.kind,
      messageId,
      phone: phoneDigits,
      contact_norm: input.contactNorm,
      instancia,
      mensage_type: mensageType,
      ia_pausada: iaPausada,
      warning: warning ?? null,
    },
    user.id
  );

  if (warning) {
    return { success: true, messageId, rowId, mensagem, warning, iaPausada };
  }

  return { success: true, messageId, rowId, mensagem, iaPausada };
}
