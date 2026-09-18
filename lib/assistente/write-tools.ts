/**
 * Write tools for the internal assistant.
 * Propose mode returns a confirmation card payload; execute mode runs the
 * underlying server action after the user confirms in the UI.
 */

import { randomUUID } from "crypto";
import {
  criarClienteCaso,
  updateCasoFields,
  updateCasoStatus,
} from "@/lib/actions/casos";
import {
  registrarArquivoCliente,
  uploadArquivoCliente,
} from "@/lib/actions/documentos";
import { enviarMensagem } from "@/lib/actions/mensagens";
import { criarPrazo } from "@/lib/actions/prazos";
import {
  assistenteAtendimentoHref,
  assistenteFichaArquivosHref,
  assistenteFichaHref,
  assistenteKanbanHref,
} from "@/lib/assistente/links";
import { CASO_STATUS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { PRAZO_TIPOS } from "@/lib/utils/beneficios";
import { normalizeCpf } from "@/lib/utils/cpf";
import { phoneToContactNorm } from "@/lib/utils/phone";
import type {
  AssistentePendingAnexo,
  AssistenteToolResult,
} from "@/lib/assistente/types";
import type { CasoStatus, PrazoTipo } from "@/types/database";

export const WRITE_TOOL_NAMES = [
  "enviar_whatsapp",
  "criar_prazo",
  "mover_kanban",
  "anexar_documento_ficha",
  "atualizar_caso",
  "criar_cliente_caso",
] as const;

export type AssistenteWriteToolName = (typeof WRITE_TOOL_NAMES)[number];

export function isWriteTool(name: string): name is AssistenteWriteToolName {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name);
}

export const ASSISTENTE_WRITE_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "enviar_whatsapp",
      description:
        "Propõe enviar uma mensagem de texto WhatsApp ao cliente. A UI pedirá confirmação antes de enviar. Informe telefone/contact_norm e o texto.",
      parameters: {
        type: "object",
        properties: {
          telefone: {
            type: "string",
            description: "Telefone do destinatário (com ou sem máscara)",
          },
          contact_norm: {
            type: "string",
            description: "contact_norm WhatsApp (alternativa/complemento ao telefone)",
          },
          texto: {
            type: "string",
            description: "Corpo da mensagem de texto",
          },
        },
        required: ["texto"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "criar_prazo",
      description:
        "Propõe criar um prazo (app_prazos). Confirmação na UI. Vínculo com cliente/caso/processo é OPCIONAL — título + data bastam. Tipos: exigencia_inss, recurso, pericia, audiencia, outro.",
      parameters: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          tipo: {
            type: "string",
            description: "exigencia_inss | recurso | pericia | audiencia | outro",
          },
          data_prazo: {
            type: "string",
            description:
              "Data em yyyy-mm-dd. Converta datas em português (ex.: 10 de outubro) você mesmo; se só dia/mês, use o ano corrente do relógio do system prompt (não avance sozinho para o ano seguinte).",
          },
          descricao: { type: "string" },
          cpf: {
            type: "string",
            description:
              "Opcional — CPF só se confirmado por busca. Omita se sem vínculo (não envie string vazia).",
          },
          caso_id: {
            type: "number",
            description:
              "Opcional — ID do caso só se veio de busca. Omita se sem vínculo; nunca invente.",
          },
          processo_id: {
            type: "number",
            description:
              "Opcional — ID do processo só se veio de busca. Omita se sem vínculo; nunca invente.",
          },
        },
        required: ["titulo", "tipo", "data_prazo"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "mover_kanban",
      description:
        "Propõe mover um caso no funil (casos_novos.status). Confirmação na UI. Status válidos: em_atendimento, consultar_processo, abertura_processo, aguardando_analise, aguardando_aprovacao, atendimento_humano, processo_finalizado.",
      parameters: {
        type: "object",
        properties: {
          caso_id: { type: "number", description: "ID do caso (casos_novos.id)" },
          status: { type: "string", description: "Novo status do kanban" },
        },
        required: ["caso_id", "status"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "anexar_documento_ficha",
      description:
        "Propõe registrar um documento/mídia na ficha do cliente (imagem, vídeo, PDF, docs). Prefira url_media pública (use a do ANEXO PENDENTE da sessão se houver). Alternativa: file_base64 + file_name + mime_type. Pasta: geral | caso:{id} | processo:{id} | custom:{nome}. Confirmação na UI.",
      parameters: {
        type: "object",
        properties: {
          contact_norm: {
            type: "string",
            description: "Telefone / contact_norm (obrigatório se sem CPF)",
          },
          cpf: { type: "string" },
          pasta: {
            type: "string",
            description: "geral | caso:123 | processo:456 | custom:Nome",
          },
          nome_documento: { type: "string" },
          descricao: { type: "string" },
          url_media: {
            type: "string",
            description: "URL pública do arquivo (preferencial)",
          },
          file_base64: {
            type: "string",
            description: "Conteúdo base64 se não houver URL",
          },
          file_name: { type: "string" },
          mime_type: {
            type: "string",
            description:
              "MIME do arquivo (ex.: image/jpeg, video/mp4, application/pdf)",
          },
          caso_id: { type: "number" },
          processo_id: { type: "number" },
        },
        required: ["pasta"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "atualizar_caso",
      description:
        "Propõe atualizar campos da ficha do caso (casos_novos). Confirmação na UI. Só envie campos que devem mudar.",
      parameters: {
        type: "object",
        properties: {
          caso_id: { type: "number" },
          nome: { type: "string" },
          cpf: { type: "string" },
          data_nascimento: { type: "string" },
          telefone: { type: "string" },
          beneficio_identificado: { type: "string" },
          area: { type: "string" },
          tipo_segurado: { type: "string" },
          ja_negou_inss: { type: "boolean" },
          motivo_negativa: { type: "string" },
          ja_tem_processo: { type: "boolean" },
          ja_recebe_beneficio: { type: "string" },
          requisitos_preenchidos: { type: "string" },
          requisitos_pendentes: { type: "string" },
          pontos_analise_juridica: { type: "string" },
          beneficios_alternativos: { type: "string" },
          consulta_tse: { type: "string" },
          consulta_dap_caf: { type: "string" },
          consulta_jf: { type: "string" },
          documentos_recebidos: { type: "string" },
          documentos_faltantes: { type: "string" },
        },
        required: ["caso_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "criar_cliente_caso",
      description:
        "Propõe criar cliente/pessoa + caso de triagem em casos_novos. OBRIGATÓRIO: nome, telefone WhatsApp e status do funil. Antes: confirme telefone e pergunte o estágio (liste os status). Confirmação na UI. Use buscar_pessoas antes para evitar duplicata.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome completo do cliente" },
          telefone: {
            type: "string",
            description: "Telefone WhatsApp (obrigatório — CRM usa telefone como chave)",
          },
          cpf: { type: "string", description: "CPF (opcional)" },
          beneficio_identificado: {
            type: "string",
            description: "Benefício / tipo de demanda (ex.: BPC, aposentadoria rural)",
          },
          tipo_segurado: {
            type: "string",
            description: "Tipo de segurado (ex.: rural, urbano)",
          },
          area: { type: "string", description: "Área do caso (opcional)" },
          status: {
            type: "string",
            description:
              "Status kanban inicial OBRIGATÓRIO. Valores: em_atendimento, consultar_processo, abertura_processo, aguardando_analise, aguardando_aprovacao, atendimento_humano, processo_finalizado.",
          },
        },
        required: ["nome", "telefone", "status"],
      },
    },
  },
] as const;

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
    return Math.trunc(Number(v));
  }
  return null;
}

/** Positive DB id only; empty string / 0 / NaN → undefined (omit FK). */
function optionalPositiveId(v: unknown): number | undefined {
  const n = num(v);
  if (n == null || n <= 0) return undefined;
  return n;
}

/** Normalized CPF or undefined; empty / whitespace → undefined. */
function optionalCpf(v: unknown): string | undefined {
  const raw = str(v);
  if (!raw) return undefined;
  const cpf = normalizeCpf(raw);
  return cpf || undefined;
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

const CASO_STATUS_VALUES = new Set(CASO_STATUS.map((s) => s.value));
const PRAZO_TIPO_VALUES = new Set(PRAZO_TIPOS.map((t) => t.value));

function statusLabel(status: string): string {
  return CASO_STATUS.find((s) => s.value === status)?.label ?? status;
}

function prazoTipoLabel(tipo: string): string {
  return PRAZO_TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
}

type ProposeOk = {
  ok: true;
  normalizedArgs: Record<string, unknown>;
  label: string;
  summary: string;
};

type ProposeErr = { ok: false; summary: string };

function proposeEnviarWhatsapp(
  args: Record<string, unknown>
): ProposeOk | ProposeErr {
  const texto = str(args.texto) || str(args.text);
  const telefone = str(args.telefone) || str(args.phone);
  const contactRaw = str(args.contact_norm) || telefone;
  if (!texto) return { ok: false, summary: "Informe o texto da mensagem." };
  if (!contactRaw) {
    return { ok: false, summary: "Informe telefone ou contact_norm." };
  }
  const contact_norm = phoneToContactNorm(contactRaw);
  const phone = phoneToContactNorm(telefone || contactRaw);
  if (!phone) return { ok: false, summary: "Telefone inválido." };

  const preview = texto.length > 120 ? `${texto.slice(0, 117)}…` : texto;
  return {
    ok: true,
    normalizedArgs: { telefone: phone, contact_norm, texto },
    label: `WhatsApp → ${contact_norm}`,
    summary: `Enviar WhatsApp para ${contact_norm}: "${preview}"`,
  };
}

function proposeCriarPrazo(
  args: Record<string, unknown>
): ProposeOk | ProposeErr {
  const titulo = str(args.titulo);
  const tipo = str(args.tipo) as PrazoTipo;
  const data_prazo = str(args.data_prazo);
  if (!titulo) return { ok: false, summary: "Informe o título do prazo." };
  if (!PRAZO_TIPO_VALUES.has(tipo)) {
    return {
      ok: false,
      summary: `Tipo inválido. Use: ${[...PRAZO_TIPO_VALUES].join(", ")}.`,
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data_prazo)) {
    return { ok: false, summary: "data_prazo deve ser yyyy-mm-dd." };
  }

  const cpf = optionalCpf(args.cpf);
  const caso_id = optionalPositiveId(args.caso_id);
  const processo_id = optionalPositiveId(args.processo_id);
  const descricao = str(args.descricao) || undefined;

  return {
    ok: true,
    normalizedArgs: {
      titulo,
      tipo,
      data_prazo,
      ...(descricao ? { descricao } : {}),
      ...(cpf ? { cpf } : {}),
      ...(caso_id != null ? { caso_id } : {}),
      ...(processo_id != null ? { processo_id } : {}),
    },
    label: `Prazo: ${titulo}`,
    summary: `Criar prazo "${titulo}" (${prazoTipoLabel(tipo)}) em ${data_prazo}.`,
  };
}

function proposeMoverKanban(
  args: Record<string, unknown>
): ProposeOk | ProposeErr {
  const caso_id = num(args.caso_id) ?? num(args.id);
  const status = str(args.status);
  if (caso_id == null) return { ok: false, summary: "Informe caso_id." };
  if (!CASO_STATUS_VALUES.has(status as CasoStatus)) {
    return {
      ok: false,
      summary: `Status inválido. Use: ${[...CASO_STATUS_VALUES].join(", ")}.`,
    };
  }
  return {
    ok: true,
    normalizedArgs: { caso_id, status },
    label: `Kanban #${caso_id} → ${statusLabel(status)}`,
    summary: `Mover caso #${caso_id} para "${statusLabel(status)}".`,
  };
}

function proposeAnexarDocumento(
  args: Record<string, unknown>,
  pendingAnexo?: AssistentePendingAnexo | null
): ProposeOk | ProposeErr {
  const pasta = str(args.pasta) || "geral";
  const cpf = str(args.cpf) ? normalizeCpf(str(args.cpf)) : "";
  const contactRaw = str(args.contact_norm) || str(args.telefone);
  const contact_norm = contactRaw ? phoneToContactNorm(contactRaw) : "";
  if (!cpf && !contact_norm) {
    return { ok: false, summary: "Informe cpf e/ou contact_norm." };
  }

  // Prefer explicit args; fall back to session pending attachment.
  let url_media = str(args.url_media);
  let file_base64 = str(args.file_base64);
  let file_name = str(args.file_name) || str(args.fileName);
  let mime_type =
    str(args.mime_type) || str(args.mimeType) || "application/octet-stream";

  if (!url_media && !file_base64 && pendingAnexo?.url_media) {
    url_media = pendingAnexo.url_media;
    if (!file_name) file_name = pendingAnexo.nome_arquivo;
    if (!mime_type || mime_type === "application/octet-stream") {
      mime_type = pendingAnexo.mime || mime_type;
    }
  }

  const nome_documento =
    str(args.nome_documento) ||
    str(args.nomeDocumento) ||
    (file_name ? file_name.replace(/\.[^.]+$/, "") : "") ||
    (pendingAnexo?.nome_arquivo
      ? pendingAnexo.nome_arquivo.replace(/\.[^.]+$/, "")
      : "") ||
    "Arquivo";

  if (!url_media && !file_base64) {
    return {
      ok: false,
      summary:
        "Informe url_media ou file_base64 (+ file_name). Se houver anexo na sessão, use a url_media pendente.",
    };
  }
  if (file_base64 && !file_name) {
    return { ok: false, summary: "file_base64 exige file_name." };
  }

  // Accept images, video, audio, PDFs and common office/docs (and url_media of any type).
  if (file_base64 || mime_type) {
    const mimeOk =
      mime_type === "application/octet-stream" ||
      mime_type.startsWith("image/") ||
      mime_type.startsWith("video/") ||
      mime_type.startsWith("audio/") ||
      mime_type.startsWith("text/") ||
      mime_type === "application/pdf" ||
      mime_type.includes("word") ||
      mime_type.includes("sheet") ||
      mime_type.includes("presentation") ||
      mime_type.includes("officedocument") ||
      mime_type === "application/msword" ||
      mime_type === "application/rtf" ||
      /\.(jpe?g|png|gif|webp|mp4|webm|mov|pdf|txt|md|docx?|xlsx?|pptx?)$/i.test(
        file_name
      );
    if (!mimeOk && !url_media) {
      return {
        ok: false,
        summary: `mime_type não suportado: ${mime_type}. Use imagem, vídeo, áudio ou documento.`,
      };
    }
  }

  const caso_id = num(args.caso_id);
  const processo_id = num(args.processo_id);
  const descricao = str(args.descricao) || undefined;

  return {
    ok: true,
    normalizedArgs: {
      pasta,
      nome_documento,
      ...(cpf ? { cpf } : {}),
      ...(contact_norm ? { contact_norm } : {}),
      ...(url_media ? { url_media } : {}),
      ...(file_base64
        ? { file_base64, file_name, mime_type }
        : {}),
      ...(descricao ? { descricao } : {}),
      ...(caso_id != null ? { caso_id } : {}),
      ...(processo_id != null ? { processo_id } : {}),
    },
    label: `Anexo: ${nome_documento}`,
    summary: `Anexar "${nome_documento}" na pasta ${pasta}${
      cpf ? ` (CPF ${cpf})` : contact_norm ? ` (${contact_norm})` : ""
    }.`,
  };
}

const CASO_FIELD_KEYS = [
  "nome",
  "cpf",
  "data_nascimento",
  "telefone",
  "beneficio_identificado",
  "area",
  "tipo_segurado",
  "ja_negou_inss",
  "motivo_negativa",
  "ja_tem_processo",
  "ja_recebe_beneficio",
  "requisitos_preenchidos",
  "requisitos_pendentes",
  "pontos_analise_juridica",
  "beneficios_alternativos",
  "consulta_tse",
  "consulta_dap_caf",
  "consulta_jf",
  "documentos_recebidos",
  "documentos_faltantes",
] as const;

function proposeAtualizarCaso(
  args: Record<string, unknown>
): ProposeOk | ProposeErr {
  const caso_id = num(args.caso_id) ?? num(args.id);
  if (caso_id == null) return { ok: false, summary: "Informe caso_id." };

  const fields: Record<string, unknown> = {};
  for (const key of CASO_FIELD_KEYS) {
    if (!(key in args) || args[key] === undefined) continue;
    if (key === "ja_negou_inss" || key === "ja_tem_processo") {
      const b = bool(args[key]);
      if (b != null) fields[key] = b;
      continue;
    }
    if (key === "cpf") {
      const c = str(args[key]);
      fields[key] = c ? normalizeCpf(c) : null;
      continue;
    }
    const v = args[key];
    if (typeof v === "string") fields[key] = v.trim() || null;
    else if (v === null) fields[key] = null;
  }

  if (!Object.keys(fields).length) {
    return { ok: false, summary: "Informe ao menos um campo para atualizar." };
  }

  const keys = Object.keys(fields).join(", ");
  return {
    ok: true,
    normalizedArgs: { caso_id, fields },
    label: `Atualizar caso #${caso_id}`,
    summary: `Atualizar caso #${caso_id}: ${keys}.`,
  };
}

function proposeCriarClienteCaso(
  args: Record<string, unknown>
): ProposeOk | ProposeErr {
  const nome = str(args.nome);
  const telefone = str(args.telefone);
  if (!nome) return { ok: false, summary: "Informe o nome do cliente." };
  if (!telefone) {
    return {
      ok: false,
      summary:
        "Telefone WhatsApp é obrigatório para criar no CRM. Peça o telefone e o estágio do funil ao usuário, depois chame criar_cliente_caso de novo (não diga que já criou).",
    };
  }
  if (phoneToContactNorm(telefone).length < 10) {
    return { ok: false, summary: "Telefone inválido." };
  }

  const statusRaw = str(args.status);
  if (!statusRaw || !CASO_STATUS_VALUES.has(statusRaw as CasoStatus)) {
    const opts = CASO_STATUS.map((s) => `${s.value} (${s.label})`).join("; ");
    return {
      ok: false,
      summary: `Informe o status do funil antes de criar. Opções: ${opts}. Pergunte ao usuário e chame de novo com status.`,
    };
  }
  const status = statusRaw as CasoStatus;

  const cpfRaw = str(args.cpf);
  const cpf = cpfRaw ? normalizeCpf(cpfRaw) : "";
  if (cpf && cpf.length !== 11) {
    return { ok: false, summary: "CPF inválido (11 dígitos)." };
  }

  const beneficio =
    str(args.beneficio_identificado) || str(args.beneficio) || "";
  const tipo_segurado = str(args.tipo_segurado);
  const area = str(args.area);

  const parts = [
    nome,
    `tel ${phoneToContactNorm(telefone)}`,
    cpf ? `CPF ${cpf}` : null,
    beneficio ? `benefício ${beneficio}` : null,
    `funil ${statusLabel(status)}`,
  ].filter(Boolean);

  return {
    ok: true,
    normalizedArgs: {
      nome,
      telefone,
      status,
      ...(cpf ? { cpf } : {}),
      ...(beneficio ? { beneficio_identificado: beneficio } : {}),
      ...(tipo_segurado ? { tipo_segurado } : {}),
      ...(area ? { area } : {}),
    },
    label: `Criar cliente: ${nome} → ${statusLabel(status)}`,
    summary: `Criar cliente/caso: ${parts.join(" · ")}.`,
  };
}

function proposeWrite(
  name: AssistenteWriteToolName,
  args: Record<string, unknown>,
  pendingAnexo?: AssistentePendingAnexo | null
): ProposeOk | ProposeErr {
  switch (name) {
    case "enviar_whatsapp":
      return proposeEnviarWhatsapp(args);
    case "criar_prazo":
      return proposeCriarPrazo(args);
    case "mover_kanban":
      return proposeMoverKanban(args);
    case "anexar_documento_ficha":
      return proposeAnexarDocumento(args, pendingAnexo);
    case "atualizar_caso":
      return proposeAtualizarCaso(args);
    case "criar_cliente_caso":
      return proposeCriarClienteCaso(args);
  }
}

/** Validates args and returns a pending-confirmation result (does not mutate). */
export async function proposeAssistenteWriteTool(
  name: AssistenteWriteToolName,
  rawArgs: unknown,
  opts?: { pendingAnexo?: AssistentePendingAnexo | null }
): Promise<AssistenteToolResult> {
  const proposed = proposeWrite(name, asRecord(rawArgs), opts?.pendingAnexo);
  if (!proposed.ok) {
    return { ok: false, summary: proposed.summary };
  }

  const confirmationId = randomUUID();
  return {
    ok: true,
    requiresConfirmation: true,
    confirmationId,
    confirmationLabel: proposed.label,
    summary: `Aguardando confirmação: ${proposed.summary}`,
    data: { normalizedArgs: proposed.normalizedArgs },
  };
}

async function execEnviarWhatsapp(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const texto = str(args.texto);
  const contact_norm = phoneToContactNorm(
    str(args.contact_norm) || str(args.telefone)
  );
  const phone = phoneToContactNorm(str(args.telefone) || contact_norm);
  if (!texto || !phone) {
    return { ok: false, summary: "Dados incompletos para enviar WhatsApp." };
  }

  const result = await enviarMensagem({
    kind: "text",
    phone,
    contactNorm: contact_norm || phone,
    text: texto,
  });

  return {
    ok: true,
    summary: result.warning
      ? `WhatsApp enviado com aviso: ${result.warning}`
      : `WhatsApp enviado para ${contact_norm || phone}.`,
    links: [
      {
        label: "Abrir atendimento",
        href: assistenteAtendimentoHref(contact_norm || phone),
      },
    ],
    data: { messageId: result.messageId, rowId: result.rowId },
  };
}

/** Drop IDs that would violate app_prazos FK (invented / stale). */
async function verifiedPrazoLinks(input: {
  caso_id?: number;
  processo_id?: number;
}): Promise<{ caso_id?: number; processo_id?: number }> {
  const supabase = await createClient();
  let caso_id = input.caso_id;
  let processo_id = input.processo_id;

  if (caso_id != null) {
    const { data } = await supabase
      .from("casos_novos")
      .select("id")
      .eq("id", caso_id)
      .maybeSingle();
    if (!data) caso_id = undefined;
  }
  if (processo_id != null) {
    const { data } = await supabase
      .from("processos_clientes")
      .select("id")
      .eq("id", processo_id)
      .maybeSingle();
    if (!data) processo_id = undefined;
  }

  return {
    ...(caso_id != null ? { caso_id } : {}),
    ...(processo_id != null ? { processo_id } : {}),
  };
}

async function execCriarPrazo(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const titulo = str(args.titulo);
  const tipo = str(args.tipo) as PrazoTipo;
  const data_prazo = str(args.data_prazo);
  const cpf = optionalCpf(args.cpf);
  // Never pass empty/invalid FKs — inventing or "" breaks app_prazos_*_fkey.
  const links = await verifiedPrazoLinks({
    caso_id: optionalPositiveId(args.caso_id),
    processo_id: optionalPositiveId(args.processo_id),
  });
  await criarPrazo({
    titulo,
    tipo,
    data_prazo,
    descricao: str(args.descricao) || undefined,
    ...(cpf ? { cpf } : {}),
    ...links,
  });

  return {
    ok: true,
    summary: `Prazo "${titulo}" criado para ${data_prazo}.`,
    links: [
      cpf
        ? { label: "Abrir ficha", href: assistenteFichaHref({ cpf }) }
        : { label: "Ver prazos", href: "/prazos" },
    ],
  };
}

async function execMoverKanban(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const caso_id = num(args.caso_id);
  const status = str(args.status) as CasoStatus;
  if (caso_id == null) {
    return { ok: false, summary: "caso_id ausente." };
  }

  const result = await updateCasoStatus(caso_id, status);
  const extras: string[] = [];
  if (result.aprovacaoCriada) extras.push("pendência de aprovação criada");
  if (result.encaminhamento?.enviada) extras.push("mensagem de encaminhamento enviada");
  if (result.encaminhamento?.warning) extras.push(result.encaminhamento.warning);

  return {
    ok: true,
    summary:
      `Caso #${caso_id} movido para "${statusLabel(status)}".` +
      (extras.length ? ` (${extras.join("; ")})` : ""),
    links: [{ label: `Caso #${caso_id}`, href: assistenteKanbanHref(caso_id) }],
  };
}

async function execAnexarDocumento(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const pasta = str(args.pasta) || "geral";
  const cpf = str(args.cpf) || null;
  const contact_norm =
    phoneToContactNorm(str(args.contact_norm)) ||
    (cpf ? "" : "");
  if (!cpf && !contact_norm) {
    return { ok: false, summary: "cpf ou contact_norm obrigatório." };
  }

  const nome_documento = str(args.nome_documento) || "Arquivo";
  const descricao = str(args.descricao) || undefined;
  const caso_id = num(args.caso_id);
  const processo_id = num(args.processo_id);
  const url_media = str(args.url_media);
  const file_base64 = str(args.file_base64);

  let docId: number | undefined;

  if (file_base64) {
    const up = await uploadArquivoCliente({
      cpf,
      contactNorm: contact_norm,
      pasta,
      casoId: caso_id,
      processoId: processo_id,
      nomeDocumento: nome_documento,
      descricao,
      fileBase64: file_base64,
      fileName: str(args.file_name) || "arquivo.bin",
      mimeType: str(args.mime_type) || "application/octet-stream",
    });
    docId = up.docId;
  } else {
    const reg = await registrarArquivoCliente({
      cpf,
      contactNorm: contact_norm,
      pasta,
      casoId: caso_id,
      processoId: processo_id,
      nomeDocumento: nome_documento,
      descricao,
      urlMedia: url_media,
    });
    docId = reg.docId;
  }

  const href = assistenteFichaArquivosHref({
    cpf: cpf ? normalizeCpf(cpf) : null,
    contactNorm: contact_norm || null,
    pasta,
  });

  return {
    ok: true,
    summary: `Documento "${nome_documento}" anexado na pasta ${pasta}. Link: ${href}.`,
    links: [
      { label: "Abrir pasta na ficha", href },
      {
        label: "Abrir ficha",
        href: assistenteFichaHref({
          cpf: cpf ? normalizeCpf(cpf) : null,
          contactNorm: contact_norm || null,
        }),
      },
    ],
    data: { docId, pasta },
  };
}

async function execAtualizarCaso(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const caso_id = num(args.caso_id);
  if (caso_id == null) return { ok: false, summary: "caso_id ausente." };

  const fieldsRaw = asRecord(args.fields);
  const fields =
    Object.keys(fieldsRaw).length > 0
      ? fieldsRaw
      : (() => {
          const f: Record<string, unknown> = {};
          for (const key of CASO_FIELD_KEYS) {
            if (key in args) f[key] = args[key];
          }
          return f;
        })();

  await updateCasoFields(
    caso_id,
    fields as Parameters<typeof updateCasoFields>[1]
  );

  return {
    ok: true,
    summary: `Caso #${caso_id} atualizado. Link: ${assistenteKanbanHref(caso_id)}.`,
    links: [{ label: `Caso #${caso_id}`, href: assistenteKanbanHref(caso_id) }],
  };
}

async function execCriarClienteCaso(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const nome = str(args.nome);
  const telefone = str(args.telefone);
  const statusRaw = str(args.status);
  if (!nome || !telefone) {
    return { ok: false, summary: "Nome e telefone são obrigatórios." };
  }
  if (!statusRaw || !CASO_STATUS_VALUES.has(statusRaw as CasoStatus)) {
    return {
      ok: false,
      summary: `Status do funil obrigatório. Use: ${[...CASO_STATUS_VALUES].join(", ")}.`,
    };
  }
  const status = statusRaw as CasoStatus;

  const result = await criarClienteCaso({
    nome,
    telefone,
    cpf: str(args.cpf) || null,
    beneficio_identificado: str(args.beneficio_identificado) || null,
    tipo_segurado: str(args.tipo_segurado) || null,
    area: str(args.area) || null,
    status,
  });

  const verb = result.created ? "Criado" : "Já existia — dados completados";
  return {
    ok: true,
    summary: `${verb}: ${result.nome} (caso #${result.casoId}, ${statusLabel(result.status)}). Links: ficha ${result.href}, kanban ${assistenteKanbanHref(result.casoId)}.`,
    links: [
      { label: "Abrir ficha", href: result.href },
      {
        label: "Arquivos da ficha",
        href: assistenteFichaArquivosHref({
          cpf: result.cpf,
          contactNorm: phoneToContactNorm(result.telefone),
        }),
      },
      { label: "Abrir no Kanban", href: assistenteKanbanHref(result.casoId) },
    ],
    data: result,
  };
}

/** Executes a previously proposed write tool (after UI confirmation). */
export async function executeAssistenteWriteTool(
  name: AssistenteWriteToolName,
  rawArgs: unknown
): Promise<AssistenteToolResult> {
  const args = asRecord(rawArgs);
  try {
    switch (name) {
      case "enviar_whatsapp":
        return await execEnviarWhatsapp(args);
      case "criar_prazo":
        return await execCriarPrazo(args);
      case "mover_kanban":
        return await execMoverKanban(args);
      case "anexar_documento_ficha":
        return await execAnexarDocumento(args);
      case "atualizar_caso":
        return await execAtualizarCaso(args);
      case "criar_cliente_caso":
        return await execCriarClienteCaso(args);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao executar ação";
    return { ok: false, summary: msg };
  }
}

/**
 * Fills missing media fields from session pending anexo (confirm safety net).
 */
export function applyPendingAnexoToWriteArgs(
  name: string,
  args: Record<string, unknown>,
  pendingAnexo?: AssistentePendingAnexo | null
): Record<string, unknown> {
  if (name !== "anexar_documento_ficha" || !pendingAnexo?.url_media) {
    return args;
  }
  const hasUrl = typeof args.url_media === "string" && args.url_media.trim();
  const hasB64 =
    typeof args.file_base64 === "string" && args.file_base64.trim();
  if (hasUrl || hasB64) return args;
  return {
    ...args,
    url_media: pendingAnexo.url_media,
    ...(args.file_name || args.fileName
      ? {}
      : { file_name: pendingAnexo.nome_arquivo }),
    ...(args.mime_type || args.mimeType
      ? {}
      : { mime_type: pendingAnexo.mime }),
    ...(args.nome_documento || args.nomeDocumento
      ? {}
      : {
          nome_documento: pendingAnexo.nome_arquivo.replace(/\.[^.]+$/, ""),
        }),
  };
}

/**
 * Resolves args for execute: prefer result.data.normalizedArgs from the
 * pending trace item, else raw args.
 */
export function resolveWriteArgs(item: {
  args: Record<string, unknown>;
  result: AssistenteToolResult;
}): Record<string, unknown> {
  const data = item.result.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const norm = (data as { normalizedArgs?: unknown }).normalizedArgs;
    if (norm && typeof norm === "object" && !Array.isArray(norm)) {
      return norm as Record<string, unknown>;
    }
  }
  return item.args;
}
