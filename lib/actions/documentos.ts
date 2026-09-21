"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getAppUser } from "@/lib/actions/auth";
import { sendMedia, type EvoGoMediaType } from "@/lib/evogo/client";
import { getWhatsAppInstancia } from "@/lib/config/app-config";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeCpf } from "@/lib/utils/cpf";
import {
  pastaCustomKey,
  storagePastaSegment,
} from "@/lib/utils/ficha";
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

function revalidateDocs(opts: {
  casoId?: number | null;
  cpf?: string | null;
  contactNorm?: string | null;
}) {
  if (opts.casoId) revalidatePath(`/kanban/${opts.casoId}`);
  if (opts.cpf) revalidatePath(`/clientes/${opts.cpf}`);
  if (opts.contactNorm) {
    revalidatePath(`/clientes/contato/${opts.contactNorm}`);
  }
  revalidatePath("/clientes");
}

function assertPasta(pasta: string): string {
  const value = pasta.trim();
  if (
    value === "geral" ||
    value.startsWith("caso:") ||
    value.startsWith("processo:") ||
    value.startsWith("custom:")
  ) {
    return value;
  }
  throw new Error("Pasta inválida");
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

  const { data: caso } = await service
    .from("casos_novos")
    .select("id, cpf, telefone")
    .eq("id", input.casoId)
    .maybeSingle();
  const cpf = caso?.cpf ? normalizeCpf(caso.cpf) : null;
  const contactNorm = phoneToContactNorm(caso?.telefone) || null;

  const { data: doc, error } = await service
    .from("documentos_cliente")
    .insert({
      caso_id: input.casoId,
      nome_documento: input.nomeDocumento.trim(),
      descricao: input.descricao?.trim() || null,
      url_media: pub.publicUrl,
      origem: "advogado",
      requer_assinatura: input.requerAssinatura,
      pasta: `caso:${input.casoId}`,
      cpf,
      contact_norm: contactNorm,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await logEvent(doc.id, "upload_advogado", {
    caso_id: input.casoId,
    nome_documento: input.nomeDocumento,
    requer_assinatura: input.requerAssinatura,
  });

  revalidateDocs({ casoId: input.casoId, cpf, contactNorm });
  return { success: true, docId: doc.id };
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type ArquivoRegistroInput = {
  urlMedia: string;
  nomeDocumento?: string;
  descricao?: string;
};

/** Registra um ou mais arquivos já no Storage — 1 insert batch + 1 revalidate. */
export async function registrarArquivosCliente(input: {
  cpf?: string | null;
  contactNorm: string;
  pasta: string;
  casoId?: number | null;
  processoId?: number | null;
  arquivos: ArquivoRegistroInput[];
}) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const contactNorm = phoneToContactNorm(input.contactNorm);
  const cpf = input.cpf ? normalizeCpf(input.cpf) : null;
  if (!contactNorm && !cpf) {
    throw new Error("Informe o CPF ou o telefone da pessoa");
  }
  if (!input.arquivos.length) throw new Error("Nenhum arquivo para registrar");

  const pasta = assertPasta(input.pasta);
  let casoId = input.casoId ?? null;
  let processoId = input.processoId ?? null;
  if (pasta.startsWith("caso:")) {
    const parsed = Number(pasta.slice("caso:".length));
    if (Number.isInteger(parsed)) casoId = parsed;
  }
  if (pasta.startsWith("processo:")) {
    const parsed = Number(pasta.slice("processo:".length));
    if (Number.isInteger(parsed)) processoId = parsed;
  }

  const rows = input.arquivos.map((a) => {
    const url = a.urlMedia.trim();
    if (!url) throw new Error("URL do arquivo ausente");
    return {
      caso_id: casoId,
      processo_id: processoId,
      nome_documento: a.nomeDocumento?.trim() || "Arquivo",
      descricao: a.descricao?.trim() || null,
      url_media: url,
      origem: "advogado" as const,
      pasta,
      cpf,
      contact_norm: contactNorm || null,
    };
  });

  const supabase = await createClient();
  const { data: docs, error } = await supabase
    .from("documentos_cliente")
    .insert(rows)
    .select("id");

  if (error) throw new Error(error.message);

  const ids = (docs ?? []).map((d) => d.id);
  if (ids[0]) {
    await logEvent(ids[0], "upload_ficha", {
      pasta,
      caso_id: casoId,
      processo_id: processoId,
      count: ids.length,
      doc_ids: ids,
    });
  }
  revalidateDocs({ casoId, cpf, contactNorm });

  return { success: true, docIds: ids };
}

/** Um arquivo — delega ao batch. */
export async function registrarArquivoCliente(input: {
  cpf?: string | null;
  contactNorm: string;
  pasta: string;
  casoId?: number | null;
  processoId?: number | null;
  nomeDocumento?: string;
  descricao?: string;
  urlMedia: string;
}) {
  const result = await registrarArquivosCliente({
    cpf: input.cpf,
    contactNorm: input.contactNorm,
    pasta: input.pasta,
    casoId: input.casoId,
    processoId: input.processoId,
    arquivos: [
      {
        urlMedia: input.urlMedia,
        nomeDocumento: input.nomeDocumento,
        descricao: input.descricao,
      },
    ],
  });
  return { success: true, docId: result.docIds[0] };
}

/** Upload na ficha via base64 (legado / fallback). Preferir upload direto + registrarArquivoCliente. */
export async function uploadArquivoCliente(input: {
  cpf?: string | null;
  contactNorm: string;
  pasta: string;
  casoId?: number | null;
  processoId?: number | null;
  nomeDocumento?: string;
  descricao?: string;
  fileBase64: string;
  fileName: string;
  mimeType: string;
}) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const contactNorm = phoneToContactNorm(input.contactNorm);
  const cpf = input.cpf ? normalizeCpf(input.cpf) : null;
  if (!contactNorm && !cpf) {
    throw new Error("Informe o CPF ou o telefone da pessoa");
  }

  const pasta = assertPasta(input.pasta);
  const buffer = base64ToBuffer(input.fileBase64);
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("Arquivo maior que 25 MB");
  }

  let casoId = input.casoId ?? null;
  let processoId = input.processoId ?? null;
  if (pasta.startsWith("caso:")) {
    const parsed = Number(pasta.slice("caso:".length));
    if (Number.isInteger(parsed)) casoId = parsed;
  }
  if (pasta.startsWith("processo:")) {
    const parsed = Number(pasta.slice("processo:".length));
    if (Number.isInteger(parsed)) processoId = parsed;
  }

  const supabase = await createClient();
  const ext = input.fileName.includes(".")
    ? input.fileName.split(".").pop()!.toLowerCase()
    : "bin";
  const personKey = cpf || contactNorm;
  const storagePath = `clientes/${personKey}/${storagePastaSegment(pasta)}/${randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("mensagens-media")
    .upload(storagePath, buffer, {
      contentType: input.mimeType || "application/octet-stream",
      upsert: false,
    });
  if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);

  const { data: pub } = supabase.storage
    .from("mensagens-media")
    .getPublicUrl(storagePath);

  return registrarArquivoCliente({
    cpf,
    contactNorm,
    pasta,
    casoId,
    processoId,
    nomeDocumento:
      input.nomeDocumento?.trim() ||
      input.fileName.replace(/\.[^.]+$/, "") ||
      "Arquivo",
    descricao: input.descricao,
    urlMedia: pub.publicUrl,
  });
}

export async function criarPastaCliente(input: {
  cpf?: string | null;
  contactNorm: string;
  nome: string;
}) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const nome = input.nome.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!nome) throw new Error("Informe o nome da pasta");

  const contactNorm = phoneToContactNorm(input.contactNorm);
  const cpf = input.cpf ? normalizeCpf(input.cpf) : null;
  if (!contactNorm && !cpf) {
    throw new Error("Informe o CPF ou o telefone da pessoa");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documentos_pastas")
    .insert({
      nome,
      cpf,
      contact_norm: contactNorm || null,
    })
    .select("id, nome")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("Já existe uma pasta com esse nome");
    }
    throw new Error(error.message);
  }

  revalidateDocs({ cpf, contactNorm });
  return { success: true, pastaId: data.id, pasta: pastaCustomKey(data.nome) };
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

  let caso: {
    id: number;
    telefone: string | null;
    cpf: string | null;
    documentos_faltantes: string | null;
  } | null = null;
  if (doc.caso_id != null) {
    const { data } = await service
      .from("casos_novos")
      .select("id, telefone, cpf, documentos_faltantes")
      .eq("id", doc.caso_id)
      .maybeSingle();
    caso = data;
  }

  const phoneDigits =
    phoneToContactNorm(caso?.telefone) ||
    phoneToContactNorm(doc.contact_norm);
  if (!phoneDigits) {
    throw new Error("Sem telefone — não é possível enviar");
  }
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
  if (caso && doc.requer_assinatura && !doc.assinado_em) {
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

  revalidateDocs({
    casoId: caso?.id ?? doc.caso_id,
    cpf: caso?.cpf ?? doc.cpf,
    contactNorm: phoneDigits,
  });
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

  const { data: caso } =
    doc.caso_id != null
      ? await service
          .from("casos_novos")
          .select("id, cpf, documentos_recebidos, documentos_faltantes")
          .eq("id", doc.caso_id)
          .maybeSingle()
      : { data: null };

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
  revalidateDocs({ casoId: doc.caso_id, cpf: caso?.cpf });
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
    .select("id, caso_id, cpf, contact_norm, url_media")
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
  revalidateDocs({
    casoId: doc.caso_id,
    cpf: doc.cpf,
    contactNorm: doc.contact_norm,
  });
  return { success: true };
}
