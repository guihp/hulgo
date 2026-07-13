"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getAppUser } from "@/lib/actions/auth";
import { sendMedia, type EvoGoMediaType } from "@/lib/evogo/client";
import { getWhatsAppInstancia } from "@/lib/config/app-config";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parseDocumentList } from "@/lib/utils/messages";
import { phoneToContactNorm } from "@/lib/utils/phone";
import type { Json } from "@/types/database";

const EVOGO_INSTANCE_FALLBACK = process.env.EVOGO_INSTANCE_NAME ?? "";

async function logEvent(entidadeId: number, acao: string, payload: Json) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("app_log_eventos").insert({
    usuario_id: user?.id ?? null,
    entidade: "documentos_cliente",
    entidade_id: entidadeId,
    acao,
    payload,
  });
}

function base64ToBuffer(base64: string): Buffer {
  const cleaned = base64.includes(",") ? base64.split(",").pop()! : base64;
  return Buffer.from(cleaned, "base64");
}

function revalidateDocs(casoId: number, cpf?: string | null) {
  revalidatePath(`/kanban/${casoId}`);
  if (cpf) revalidatePath(`/clientes/${cpf}`);
  revalidatePath("/arquivos");
}

/** Upload de documento feito pelo ESCRITÓRIO (contrato, procuração, petição…). */
export async function uploadDocumentoAdvogado(input: {
  casoId: number;
  nomeDocumento: string;
  descricao?: string;
  fileBase64: string;
  fileName: string;
  mimeType: string;
  requerAssinatura: boolean;
}) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (!input.nomeDocumento.trim()) throw new Error("Nome do documento é obrigatório");

  const service = createServiceClient();
  const ext = input.fileName.includes(".")
    ? input.fileName.split(".").pop()!.toLowerCase()
    : "bin";
  const storagePath = `escritorio/${input.casoId}/${randomUUID()}.${ext}`;

  const { error: upErr } = await service.storage
    .from("mensagens-media")
    .upload(storagePath, base64ToBuffer(input.fileBase64), {
      contentType: input.mimeType || "application/octet-stream",
      upsert: false,
    });
  if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);

  const { data: pub } = service.storage
    .from("mensagens-media")
    .getPublicUrl(storagePath);

  const { data: doc, error } = await service
    .from("documentos_cliente")
    .insert({
      caso_id: input.casoId,
      nome_documento: input.nomeDocumento.trim(),
      descricao: input.descricao?.trim() || null,
      url_media: pub.publicUrl,
      origem: "advogado",
      requer_assinatura: input.requerAssinatura,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await logEvent(doc.id, "upload_advogado", {
    caso_id: input.casoId,
    nome_documento: input.nomeDocumento,
    requer_assinatura: input.requerAssinatura,
  });

  revalidateDocs(input.casoId);
  return { success: true, docId: doc.id };
}

/**
 * Envia o documento ao cliente pelo WhatsApp.
 * Se requer assinatura: adiciona "<nome> assinado" aos documentos_faltantes do caso —
 * a IA passa a cobrar e reconhece quando o cliente devolver (registrar_documento_cliente).
 * NÃO pausa a IA: ela precisa continuar ativa para receber o documento de volta.
 */
export async function enviarDocumentoCliente(input: {
  docId: number;
  mensagem: string;
}) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (user.papel !== "advogado") {
    throw new Error("Apenas advogados podem enviar documentos ao cliente");
  }

  const service = createServiceClient();
  const { data: doc, error: docErr } = await service
    .from("documentos_cliente")
    .select("*")
    .eq("id", input.docId)
    .single();
  if (docErr || !doc) throw new Error("Documento não encontrado");

  const { data: caso, error: casoErr } = await service
    .from("casos_novos")
    .select("id, telefone, cpf, documentos_faltantes")
    .eq("id", doc.caso_id)
    .single();
  if (casoErr || !caso?.telefone) {
    throw new Error("Caso sem telefone — não é possível enviar");
  }

  const phoneDigits = phoneToContactNorm(caso.telefone);
  const instancia =
    (await getWhatsAppInstancia(phoneDigits)) || EVOGO_INSTANCE_FALLBACK;

  const ext = doc.url_media.split(".").pop()?.toLowerCase() ?? "";
  const type: EvoGoMediaType = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext)
    ? "image"
    : "document";

  const messageId = await sendMedia({
    number: phoneDigits,
    url: doc.url_media,
    type,
    caption: input.mensagem.trim() || undefined,
    filename: `${doc.nome_documento}.${ext || "pdf"}`,
  });

  // registra a mensagem na conversa
  await service.rpc("upsert_mensagem", {
    p_phone: phoneDigits,
    p_type: "bot",
    p_text: input.mensagem.trim() || `[DOCUMENTO ENVIADO]: ${doc.nome_documento}`,
    p_mensagem_id: messageId,
    p_mensage_type: type,
    p_plataforma: "whatsapp",
    p_instancia: instancia,
    p_session_id: null,
    p_conteudo_media: doc.url_media,
  });

  // 3) pendência de assinatura vira "documento faltante" (a IA cobra)
  if (doc.requer_assinatura && !doc.assinado_em) {
    const pendente = `${doc.nome_documento} assinado`;
    const faltantes = parseDocumentList(caso.documentos_faltantes);
    if (!faltantes.some((f) => f.toLowerCase() === pendente.toLowerCase())) {
      await service
        .from("casos_novos")
        .update({
          documentos_faltantes: [...faltantes, pendente].join(", "),
          updated_at: new Date().toISOString(),
        })
        .eq("id", caso.id);
    }
  }

  await service
    .from("documentos_cliente")
    .update({ enviado_cliente_em: new Date().toISOString() })
    .eq("id", doc.id);

  await logEvent(doc.id, "enviado_cliente", {
    message_id: messageId,
    requer_assinatura: doc.requer_assinatura,
    phone: phoneDigits,
  });

  revalidateDocs(caso.id, caso.cpf);
  return { success: true, messageId };
}

/** Marca o documento como assinado/recebido e limpa a pendência da IA. */
export async function marcarDocumentoAssinado(docId: number) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const service = createServiceClient();
  const { data: doc, error: docErr } = await service
    .from("documentos_cliente")
    .select("id, caso_id, nome_documento")
    .eq("id", docId)
    .single();
  if (docErr || !doc) throw new Error("Documento não encontrado");

  const { data: caso } = await service
    .from("casos_novos")
    .select("id, cpf, documentos_recebidos, documentos_faltantes")
    .eq("id", doc.caso_id)
    .single();

  await service
    .from("documentos_cliente")
    .update({ assinado_em: new Date().toISOString() })
    .eq("id", docId);

  if (caso) {
    const pendente = `${doc.nome_documento} assinado`;
    const faltantes = parseDocumentList(caso.documentos_faltantes).filter(
      (f) => f.toLowerCase() !== pendente.toLowerCase()
    );
    const recebidos = parseDocumentList(caso.documentos_recebidos);
    if (!recebidos.some((r) => r.toLowerCase() === pendente.toLowerCase())) {
      recebidos.push(pendente);
    }
    await service
      .from("casos_novos")
      .update({
        documentos_faltantes: faltantes.join(", "),
        documentos_recebidos: recebidos.join(", "),
        updated_at: new Date().toISOString(),
      })
      .eq("id", caso.id);
  }

  await logEvent(docId, "assinado", {});
  revalidateDocs(doc.caso_id, caso?.cpf);
  return { success: true };
}

export async function excluirDocumento(docId: number) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (user.papel !== "advogado") {
    throw new Error("Apenas advogados podem excluir documentos");
  }

  const service = createServiceClient();
  const { data: doc } = await service
    .from("documentos_cliente")
    .select("id, caso_id, url_media")
    .eq("id", docId)
    .single();
  if (!doc) throw new Error("Documento não encontrado");

  const marker = "/mensagens-media/";
  const idx = doc.url_media.indexOf(marker);
  if (idx >= 0) {
    const path = decodeURIComponent(doc.url_media.slice(idx + marker.length));
    await service.storage.from("mensagens-media").remove([path]);
  }

  const { error } = await service
    .from("documentos_cliente")
    .delete()
    .eq("id", docId);
  if (error) throw new Error(error.message);

  await logEvent(docId, "excluido", {});
  revalidateDocs(doc.caso_id);
  return { success: true };
}
