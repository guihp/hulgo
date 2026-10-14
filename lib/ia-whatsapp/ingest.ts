import "server-only";

import type { MensagemRecebida } from "@/lib/ia-whatsapp/evogo-payload";
import { createServiceClient } from "@/lib/supabase/service";

const EXT_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
};

export function extensaoDaMidia(mime: string | null, nomeArquivo: string | null): string {
  const doNome = nomeArquivo?.includes(".")
    ? nomeArquivo.split(".").pop()!.toLowerCase().slice(0, 8)
    : "";
  if (doNome) return doNome;
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  return EXT_POR_MIME[base] ?? (base.split("/")[1] || "bin");
}

export type MensagemSalva = {
  rowId: number;
  contactNorm: string;
  conteudoMedia: string | null;
};

/** Grava a mensagem (e a mídia) no painel — equivalente ao mensagem-ingest/media-ingest. */
export async function salvarMensagemRecebida(msg: MensagemRecebida): Promise<MensagemSalva> {
  const supabase = createServiceClient();

  let texto: string | null = msg.texto || null;
  if (msg.tipo === "location" && msg.localizacao) {
    texto = JSON.stringify({
      name: msg.localizacao.nome,
      address: msg.localizacao.endereco,
      lat: msg.localizacao.lat,
      lng: msg.localizacao.lng,
    });
  } else if (msg.tipo === "contact" && msg.contato) {
    texto = JSON.stringify({ fullName: msg.contato.nome, phone: msg.contato.telefone });
  }

  const { data, error } = await supabase.rpc("upsert_mensagem", {
    p_phone: msg.telefone,
    p_type: msg.doEscritorio ? "bot" : "lead",
    p_text: texto,
    p_mensagem_id: msg.id || null,
    p_mensage_type: msg.tipo,
    p_plataforma: "whatsapp",
    p_instancia: msg.instancia,
    p_session_id: null,
    p_conteudo_media: null,
  });
  if (error) throw new Error(`upsert_mensagem: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.result_id) throw new Error("upsert_mensagem não retornou id");

  const rowId = Number(row.result_id);
  const contactNorm = row.result_contact_norm;
  let conteudoMedia: string | null = null;

  if (msg.base64 && ["image", "audio", "video", "document", "sticker"].includes(msg.tipo)) {
    const mime = (msg.mime ?? "application/octet-stream").split(";")[0].trim();
    const ext = extensaoDaMidia(msg.mime, msg.nomeArquivo);
    const path = `${contactNorm}/${msg.id || rowId}.${ext}`;
    const bytes = Buffer.from(msg.base64.replace(/^data:[^,]+,/, ""), "base64");
    let { error: upErr } = await supabase.storage
      .from("mensagens-media")
      .upload(path, bytes, { contentType: mime, upsert: true });
    if (upErr && /mime/i.test(upErr.message)) {
      // Tipo fora da lista do bucket (ex.: video/3gpp) — guarda como binário.
      ({ error: upErr } = await supabase.storage
        .from("mensagens-media")
        .upload(path, bytes, { contentType: "application/octet-stream", upsert: true }));
    }
    if (upErr) throw new Error(`Upload da mídia: ${upErr.message}`);
    conteudoMedia = supabase.storage.from("mensagens-media").getPublicUrl(path).data.publicUrl;
    await supabase.from("mensagens").update({ conteudo_media: conteudoMedia }).eq("id", rowId);
  }

  return { rowId, contactNorm, conteudoMedia };
}

/** Grava a resposta enviada pela IA (bolha do lado do escritório). */
export async function salvarRespostaIA(params: {
  telefone: string;
  texto: string;
  messageId: string;
  instancia: string | null;
}): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("upsert_mensagem", {
    p_phone: params.telefone,
    p_type: "bot",
    p_text: params.texto,
    p_mensagem_id: params.messageId,
    p_mensage_type: "text",
    p_plataforma: "whatsapp",
    p_instancia: params.instancia,
    p_session_id: "ia",
    p_conteudo_media: null,
  });
  if (error) throw new Error(`Salvar resposta da IA: ${error.message}`);
}
