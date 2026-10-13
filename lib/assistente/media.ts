/**
 * Media preprocessing for the internal assistant.
 * Reuses sandbox OpenAI helpers; skips analysis when modo=somente_salvar.
 */

import { randomUUID } from "crypto";
import {
  openaiDescribeImage,
  openaiExtractDocumentText,
  openaiTranscribeAudio,
} from "@/lib/openai/sandbox";
import { imagemParaVisao } from "@/lib/openai/imagem";
import type {
  AssistenteAnexoInput,
  AssistenteAnexoKind,
  AssistenteAnexoStored,
  AssistentePendingAnexo,
} from "@/lib/assistente/types";

const MAX_INTERPRET_BYTES = 12 * 1024 * 1024;
const MAX_SAVE_BYTES = 25 * 1024 * 1024;

/** MIME / extension families accepted by anexar_documento_ficha + composer. */
const DOC_EXT =
  /\.(pdf|txt|md|csv|json|html?|docx?|xlsx?|pptx?|odt|rtf)$/i;

export function classifyAssistenteAnexo(
  mimeType: string,
  fileName: string
): AssistenteAnexoKind | null {
  const mime = (mimeType || "").toLowerCase();
  const name = fileName || "";
  if (mime.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp|hei[cf])$/i.test(name)) {
    return "image";
  }
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(name)) {
    return "video";
  }
  if (mime.startsWith("audio/") || /\.(webm|ogg|mp3|m4a|wav|flac|oga)$/i.test(name)) {
    return "audio";
  }
  if (
    mime.startsWith("application/") ||
    mime.startsWith("text/") ||
    DOC_EXT.test(name) ||
    !mime
  ) {
    return "documento";
  }
  return "documento";
}

export function isAllowedAssistenteMime(
  mimeType: string,
  fileName: string
): boolean {
  return classifyAssistenteAnexo(mimeType, fileName) != null;
}

function base64ToBuffer(raw: string): Buffer {
  const cleaned = raw.includes(",") ? raw.split(",", 2)[1]! : raw;
  return Buffer.from(cleaned, "base64");
}

function extFromName(fileName: string, kind: AssistenteAnexoKind): string {
  if (fileName.includes(".")) {
    return fileName.split(".").pop()!.toLowerCase().slice(0, 8);
  }
  switch (kind) {
    case "image":
      return "jpg";
    case "video":
      return "mp4";
    case "audio":
      return "webm";
    default:
      return "bin";
  }
}

export type AssistenteMediaPrepared = {
  stored: AssistenteAnexoStored;
  /** Text injected into the model user turn (not always the display content). */
  modelContext: string;
  displayContent: string;
  /** Session-level pending payload (url survives follow-up turns). */
  pending: AssistentePendingAnexo;
};

/** Parse session pending_anexo jsonb (null if invalid / empty). */
export function parseAssistentePendingAnexo(
  raw: unknown
): AssistentePendingAnexo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const url_media = typeof o.url_media === "string" ? o.url_media.trim() : "";
  const mime = typeof o.mime === "string" ? o.mime.trim() : "";
  const nome_arquivo =
    typeof o.nome_arquivo === "string" ? o.nome_arquivo.trim() : "";
  const modo = o.modo;
  const kind = o.kind;
  if (!url_media || !nome_arquivo) return null;
  if (modo !== "interpretar" && modo !== "somente_salvar") return null;
  if (
    kind !== "image" &&
    kind !== "video" &&
    kind !== "audio" &&
    kind !== "documento"
  ) {
    return null;
  }
  return {
    url_media,
    mime: mime || "application/octet-stream",
    nome_arquivo,
    modo,
    kind,
  };
}

export function storedToPendingAnexo(
  stored: AssistenteAnexoStored
): AssistentePendingAnexo | null {
  const url = (stored.url ?? "").trim();
  if (!url) return null;
  return {
    url_media: url,
    mime: stored.mimeType || "application/octet-stream",
    nome_arquivo: stored.fileName,
    modo: stored.modo,
    kind: stored.kind,
  };
}

/** Injected every turn while session has a pending attachment. */
export function formatPendingAnexoBlock(
  pending: AssistentePendingAnexo
): string {
  const modoLabel =
    pending.modo === "somente_salvar" ? "SOMENTE SALVAR" : "INTERPRETAR";
  const lines = [
    `[ANEXO PENDENTE NA SESSÃO — ${modoLabel}]`,
    `Arquivo: ${pending.nome_arquivo} (${pending.mime}, ${pending.kind}).`,
    `url_media: ${pending.url_media}`,
  ];
  if (pending.modo === "somente_salvar") {
    lines.push(
      "NÃO peça reenvio do arquivo. Use esta url_media em anexar_documento_ficha.",
      "Resolva destino (pessoa via buscar_pessoas + pasta) e proponha o anexo."
    );
  } else {
    lines.push(
      "A mídia já foi interpretada no turno do upload. Se o usuário quiser arquivar, use esta url_media."
    );
  }
  return lines.join("\n");
}

/**
 * Uploads the attachment and optionally runs vision/whisper/doc extract.
 */
export async function prepareAssistenteAnexo(input: {
  anexo: AssistenteAnexoInput;
  userId: string;
  sessaoId: string;
  userText: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed createClient from server
  supabase: any;
}): Promise<AssistenteMediaPrepared> {
  const { anexo, userId, sessaoId, userText, supabase } = input;
  const kind = anexo.kind || classifyAssistenteAnexo(anexo.mimeType, anexo.fileName);
  if (!kind) {
    throw new Error("Tipo de arquivo não suportado");
  }

  const bytes = base64ToBuffer(anexo.base64);
  const maxBytes =
    anexo.modo === "somente_salvar" ? MAX_SAVE_BYTES : MAX_INTERPRET_BYTES;
  if (bytes.length > maxBytes) {
    throw new Error(
      anexo.modo === "somente_salvar"
        ? "Arquivo maior que 25 MB"
        : "Arquivo maior que 12 MB (limite para interpretar)"
    );
  }

  const mime = anexo.mimeType || "application/octet-stream";
  const fileName = anexo.fileName || `arquivo.${extFromName("", kind)}`;
  const ext = extFromName(fileName, kind);
  const path = `assistente/${userId}/${sessaoId}/${randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("mensagens-media")
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);

  const { data: pub } = supabase.storage
    .from("mensagens-media")
    .getPublicUrl(path);
  const url = pub.publicUrl;

  if (anexo.modo === "somente_salvar") {
    const stored: AssistenteAnexoStored = {
      kind,
      modo: "somente_salvar",
      fileName,
      mimeType: mime,
      url,
      transcript: null,
    };
    const label =
      kind === "image"
        ? "imagem"
        : kind === "video"
          ? "vídeo"
          : kind === "audio"
            ? "áudio"
            : "documento";
    const display =
      userText.trim() ||
      `[Anexo para salvar] ${fileName}`;
    const modelContext = [
      userText.trim() || "(sem texto adicional)",
      "",
      `[ANEXO — SOMENTE SALVAR] O usuário pediu para NÃO analisar o conteúdo.`,
      `Arquivo: ${fileName} (${mime}, ${label}).`,
      `url_media: ${url}`,
      `Resolva a pessoa com buscar_pessoas (nome basta se houver match único; não exija CPF de imediato).`,
      `Pasta: geral | caso:{id} | processo:{id} | custom:{nome}. Proponha anexar_documento_ficha com esta url_media (não invente base64; não peça reenvio).`,
    ].join("\n");

    const pending = storedToPendingAnexo(stored);
    if (!pending) throw new Error("Falha ao registrar url do anexo");
    return { stored, modelContext, displayContent: display, pending };
  }

  // interpretar
  let transcript: string | null = null;
  let interpretNote = "";

  try {
    if (kind === "image") {
      const dataUrl = await imagemParaVisao({ bytes, mimeType: mime, fileName });
      transcript = await openaiDescribeImage({
        dataUrl,
        caption: userText || undefined,
      });
    } else if (kind === "audio") {
      transcript = await openaiTranscribeAudio({
        bytes,
        fileName,
        mimeType: mime,
      });
    } else if (kind === "video") {
      // Whisper accepts some containers with audio (mp4/webm); no ffmpeg extract.
      try {
        transcript = await openaiTranscribeAudio({
          bytes,
          fileName,
          mimeType: mime,
        });
        interpretNote =
          "(transcrição do áudio do vídeo; frames não foram descritos visualmente)";
      } catch (e) {
        const msg = e instanceof Error ? e.message : "falha na transcrição";
        transcript = null;
        interpretNote = `Não foi possível extrair áudio/transcrever este vídeo (${msg}). Peça ao usuário um áudio separado ou use somente salvar.`;
      }
    } else {
      transcript = await openaiExtractDocumentText({
        bytes,
        fileName,
        mimeType: mime,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao interpretar mídia";
    throw new Error(msg);
  }

  const stored: AssistenteAnexoStored = {
    kind,
    modo: "interpretar",
    fileName,
    mimeType: mime,
    url,
    transcript,
  };

  const kindLabel =
    kind === "image"
      ? "Imagem"
      : kind === "video"
        ? "Vídeo"
        : kind === "audio"
          ? "Áudio"
          : "Documento";

  const display =
    userText.trim() ||
    (transcript
      ? `[${kindLabel}] ${fileName}`
      : `[${kindLabel} — sem análise] ${fileName}`);

  const modelParts = [
    userText.trim() || `(usuário enviou ${kindLabel.toLowerCase()} para interpretar)`,
    "",
    `[ANEXO — INTERPRETAR] ${kindLabel}: ${fileName} (${mime})`,
    url ? `url_media: ${url}` : null,
    interpretNote || null,
    transcript
      ? `Conteúdo analisado:\n${transcript}`
      : "Sem conteúdo analisado disponível.",
    "Se o usuário quiser arquivar na ficha depois, use anexar_documento_ficha com a url_media acima (não peça reenvio).",
  ].filter(Boolean);

  const pending = storedToPendingAnexo(stored);
  if (!pending) throw new Error("Falha ao registrar url do anexo");
  return {
    stored,
    modelContext: modelParts.join("\n"),
    displayContent: display,
    pending,
  };
}
