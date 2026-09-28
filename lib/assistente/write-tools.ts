/**
 * Write tools for the internal assistant.
 * Propose mode returns a confirmation card payload; execute mode runs the
 * underlying server action after the user confirms in the UI.
 */

import { randomUUID } from "crypto";
import {
  atualizarSituacaoProcesso,
  criarClienteCaso,
  excluirProcesso,
  moverProcessoColuna,
  updateCasoFields,
  updateCasoStatus,
  upsertProcesso,
  type UpsertProcessoInput,
} from "@/lib/actions/casos";
import {
  getAgenteConfig,
  getAgenteConfigVersao,
  salvarRascunhoAgente,
} from "@/lib/actions/configuracoes";
import {
  registrarArquivoCliente,
  uploadArquivoCliente,
} from "@/lib/actions/documentos";
import { enviarMensagem } from "@/lib/actions/mensagens";
import { criarPrazo } from "@/lib/actions/prazos";
import {
  labelForOffset,
  type LembreteInput,
} from "@/lib/prazos/lembretes";
import { getAppUser } from "@/lib/actions/auth";
import {
  applyPromptEditsBatch,
  clipPreview,
  parsePromptDocumento,
  parsePromptEditModo,
  type PromptEditAlteracaoInput,
  type PromptEditPreviewItem,
} from "@/lib/assistente/agente-prompt-edit";
import {
  assistenteAtendimentoHref,
  assistenteFichaArquivosHref,
  assistenteFichaHref,
  assistenteKanbanHref,
  audienciasHref,
  processosFunilHref,
} from "@/lib/assistente/links";
import { CASO_STATUS } from "@/lib/constants";
import { listKanbanColunas } from "@/lib/data/kanban-colunas";
import {
  listProcessoColunas,
  type ProcessoColunaMatch,
} from "@/lib/data/processo-colunas";
import { createClient } from "@/lib/supabase/server";
import { PRAZO_TIPOS } from "@/lib/utils/beneficios";
import { formatCpf, isValidCpf, normalizeCpf } from "@/lib/utils/cpf";
import { phoneToContactNorm } from "@/lib/utils/phone";
import {
  formatNumeroProcesso,
  isValidNumeroProcesso,
  normalizeNumeroProcesso,
} from "@/lib/utils/processo";
import {
  MODALIDADES_AUDIENCIA,
  SITUACOES_PROCESSO,
  formatValorCentavos,
  isModalidadeAudiencia,
  labelFunilProcesso,
  normalizeAreaProcesso,
  parseValorReais,
  type FunilProcesso,
  type ModalidadeAudiencia,
  type SituacaoProcesso,
} from "@/lib/utils/processos";
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
  "criar_processo",
  "atualizar_processo",
  "mover_processo",
  "definir_situacao_processo",
  "excluir_processo",
  "propor_alteracao_prompt_agente",
  "reverter_prompt_agente",
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
        "Propõe criar um prazo (app_prazos). Confirmação na UI. Vínculo com cliente/caso/processo é OPCIONAL — título + data bastam. Tipos: exigencia_inss, recurso, pericia, audiencia, outro. Para audiência: informe modalidade (presencial|virtual) e local (presencial) ou link_audiencia (virtual).",
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
          hora_prazo: {
            type: "string",
            description:
              "Opcional — horário do prazo HH:MM (America/Sao_Paulo). Se omitido, usa 08:00.",
          },
          lembretes: {
            type: "array",
            description:
              "Opcional — avisos antes do deadline. offset_minutes = minutos antes (0 = na hora). Se omitido, usa 1h antes + na hora.",
            items: {
              type: "object",
              properties: {
                offset_minutes: { type: "number" },
                label: { type: "string" },
              },
              required: ["offset_minutes"],
            },
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
          local: {
            type: "string",
            description:
              "Opcional (audiência) — local/endereço/sala da audiência presencial.",
          },
          modalidade: {
            type: "string",
            description: "Opcional (audiência) — presencial | virtual",
          },
          link_audiencia: {
            type: "string",
            description:
              "Opcional (audiência virtual) — URL da sala (http:// ou https://).",
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
        "Propõe mover um caso/atendimento no funil de VENDAS (casos_novos.status). Não serve para processos judiciais (use mover_processo). Confirmação na UI. Status = chave de coluna ativa do funil de vendas — use listar_colunas_funis para obter as chaves; nunca invente.",
      parameters: {
        type: "object",
        properties: {
          caso_id: { type: "number", description: "ID do caso (casos_novos.id)" },
          status: {
            type: "string",
            description:
              "Chave da coluna do funil de vendas (de listar_colunas_funis)",
          },
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
        "Propõe criar cliente/pessoa + caso de triagem em casos_novos. OBRIGATÓRIO: nome, telefone WhatsApp e status do funil de vendas. Antes: confirme telefone e pergunte o estágio (use listar_colunas_funis para listar as colunas). Confirmação na UI. Use buscar_pessoas antes para evitar duplicata.",
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
              "Chave da coluna inicial do funil de vendas (OBRIGATÓRIO). Use listar_colunas_funis; nunca invente.",
          },
        },
        required: ["nome", "telefone", "status"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "criar_processo",
      description:
        "Propõe cadastrar um processo judicial (processos_clientes) num funil de processos (previdenciario | civel). Confirmação na UI. OBRIGATÓRIO: nome, cpf, numero_processo (CNJ, 20 dígitos) e area. Use buscar_pessoas antes. Coluna = chave de listar_colunas_funis do funil da área (omitida → primeira coluna). Benefício só no Previdenciário. No Cível, pergunte polo_passivo e tipo_acao se faltarem.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome do cliente" },
          cpf: { type: "string", description: "CPF do cliente" },
          numero_processo: {
            type: "string",
            description: "Número CNJ (com ou sem máscara)",
          },
          area: { type: "string", description: "previdenciario | civel" },
          telefone: { type: "string" },
          tribunal: { type: "string", description: "Ex.: TRF1, TJMA" },
          coluna: {
            type: "string",
            description:
              "Chave da coluna do funil de processos da área (listar_colunas_funis)",
          },
          polo_ativo: { type: "string" },
          polo_passivo: { type: "string" },
          tipo_acao: { type: "string" },
          vara_comarca: { type: "string" },
          valor: {
            type: "string",
            description: "Valor da causa em reais (ex.: 11.239,05)",
          },
          processo_origem: {
            type: "string",
            description: "Número do processo de origem (opcional)",
          },
          situacao: {
            type: "string",
            description: `Etiqueta de situação: ${SITUACOES_PROCESSO.map((s) => s.value).join(" | ")}`,
          },
          ultimo_andamento_data: {
            type: "string",
            description: "yyyy-mm-dd ou dd/mm/aaaa",
          },
          ultimo_movimento: { type: "string" },
          observacao: { type: "string" },
          beneficio_identificado: {
            type: "string",
            description: "Só Previdenciário",
          },
          parceiro_id: {
            type: "string",
            description: "UUID de app_parceiros (só se veio de consulta)",
          },
        },
        required: ["nome", "cpf", "numero_processo", "area"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "atualizar_processo",
      description:
        "Propõe editar um processo existente. Confirmação na UI. Envie processo_id (de busca — nunca invente) e SÓ os campos que mudam; string vazia limpa o campo. Pode trocar a área (previdenciario ↔ civel). Para mover de coluna prefira mover_processo; para situação, definir_situacao_processo.",
      parameters: {
        type: "object",
        properties: {
          processo_id: { type: "number" },
          nome: { type: "string" },
          cpf: { type: "string" },
          numero_processo: { type: "string" },
          area: { type: "string", description: "previdenciario | civel" },
          telefone: { type: "string" },
          tribunal: { type: "string" },
          coluna: {
            type: "string",
            description: "Chave da coluna do funil (listar_colunas_funis)",
          },
          polo_ativo: { type: "string" },
          polo_passivo: { type: "string" },
          tipo_acao: { type: "string" },
          vara_comarca: { type: "string" },
          valor: { type: "string", description: "Valor em reais" },
          processo_origem: { type: "string" },
          situacao: {
            type: "string",
            description: `${SITUACOES_PROCESSO.map((s) => s.value).join(" | ")} (vazio limpa)`,
          },
          ultimo_andamento_data: { type: "string" },
          ultimo_movimento: { type: "string" },
          observacao: { type: "string" },
          beneficio_identificado: {
            type: "string",
            description: "Só Previdenciário",
          },
          parceiro_id: { type: "string" },
        },
        required: ["processo_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "mover_processo",
      description:
        "Propõe mover um ou vários processos judiciais para uma coluna do funil de processos. Todos precisam ser do mesmo funil (área). Coluna = chave de listar_colunas_funis. Confirmação na UI.",
      parameters: {
        type: "object",
        properties: {
          processo_ids: {
            type: "array",
            items: { type: "number" },
            description: "IDs de processos_clientes (de busca — nunca invente)",
          },
          coluna: {
            type: "string",
            description: "Chave da coluna de destino",
          },
        },
        required: ["processo_ids", "coluna"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "definir_situacao_processo",
      description: `Propõe definir (ou limpar com null/vazio) a etiqueta de situação de um ou vários processos. Situações: ${SITUACOES_PROCESSO.map((s) => `${s.value} (${s.label})`).join("; ")}. Confirmação na UI.`,
      parameters: {
        type: "object",
        properties: {
          processo_ids: {
            type: "array",
            items: { type: "number" },
            description: "IDs de processos_clientes",
          },
          situacao: {
            type: ["string", "null"],
            description: "Chave da situação; null ou vazio limpa",
          },
        },
        required: ["processo_ids"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "excluir_processo",
      description:
        "Propõe EXCLUIR um processo judicial (irreversível). Só advogado. Prazos e documentos vinculados perdem o vínculo (documentos voltam para a pasta geral). Confirmação na UI.",
      parameters: {
        type: "object",
        properties: {
          processo_id: { type: "number" },
        },
        required: ["processo_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propor_alteracao_prompt_agente",
      description:
        "Propõe pacote de alterações CIRÚRGICAS no rascunho do agente WhatsApp (persona e/ou mensagem_abertura). Só advogado. NÃO publica. Antes: ler_prompt_agente (persona + abertura) e localize TODOS os trechos impactados — um único card com alteracoes[]. Cada item: documento (persona|mensagem_abertura), modo, âncora única, trecho_novo/texto_inserir, motivo. Modos: substituir | inserir_apos | inserir_antes | substituir_tudo (só se pedirem o texto inteiro). Preferir um pacote a vários cards isolados.",
      parameters: {
        type: "object",
        properties: {
          alteracoes: {
            type: "array",
            description:
              "Lista de edições no mesmo pacote (persona e/ou abertura). Preferencial.",
            items: {
              type: "object",
              properties: {
                documento: {
                  type: "string",
                  description: "persona | mensagem_abertura",
                },
                modo: {
                  type: "string",
                  description:
                    "substituir | inserir_apos | inserir_antes | substituir_tudo",
                },
                ancora: {
                  type: "string",
                  description:
                    "Texto exato no documento (obrigatório nos modos localizados). Alias: trecho_atual.",
                },
                trecho_atual: {
                  type: "string",
                  description: "Alias de ancora.",
                },
                trecho_novo: {
                  type: "string",
                  description:
                    "Texto novo (substituir / substituir_tudo) ou fallback de inserção.",
                },
                texto_inserir: {
                  type: "string",
                  description: "Texto a inserir (inserir_apos / inserir_antes).",
                },
                motivo: {
                  type: "string",
                  description: "Frase curta deste item (local + intenção).",
                },
              },
              required: ["documento", "modo"],
            },
          },
          modo: {
            type: "string",
            description:
              "Legado: uma edição só em persona. Prefira alteracoes[]. substituir | inserir_apos | inserir_antes | substituir_tudo",
          },
          documento: {
            type: "string",
            description:
              "Legado com modo top-level: persona | mensagem_abertura (padrão persona).",
          },
          ancora: {
            type: "string",
            description:
              "Legado: texto exato. Alias: trecho_atual.",
          },
          trecho_atual: {
            type: "string",
            description: "Alias de ancora (legado).",
          },
          trecho_novo: {
            type: "string",
            description: "Legado: texto novo / fallback de inserção.",
          },
          texto_inserir: {
            type: "string",
            description: "Legado: texto a inserir.",
          },
          motivo: {
            type: "string",
            description:
              "Resumo do pacote para o card (ex.: Renomear agente em persona + abertura).",
          },
        },
        required: ["motivo"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "reverter_prompt_agente",
      description:
        "Propõe restaurar um snapshot do histórico (ler_versoes_prompt_agente) no RASCUNHO do agente WhatsApp. Só advogado. NÃO publica — após Confirmar grava via salvarRascunhoAgente; usuário publica em Configurações → Agente.",
      parameters: {
        type: "object",
        properties: {
          versao_id: {
            type: "string",
            description: "UUID da versão em app_agente_config_versoes",
          },
          motivo: {
            type: "string",
            description: "Frase curta para o card (opcional)",
          },
        },
        required: ["versao_id"],
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

const PRAZO_TIPO_VALUES = new Set(PRAZO_TIPOS.map((t) => t.value));

/** Active sales-funnel columns (app_kanban_colunas) + system keys as fallback. */
async function loadKanbanColunasMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    for (const c of await listKanbanColunas()) map.set(c.chave, c.label);
  } catch {
    // fall through to system keys
  }
  for (const s of CASO_STATUS) {
    if (!map.has(s.value)) map.set(s.value, s.label);
  }
  return map;
}

function kanbanColunasOptions(map: Map<string, string>): string {
  return [...map].map(([chave, label]) => `${chave} (${label})`).join("; ");
}

function statusLabel(status: string, map?: Map<string, string>): string {
  return (
    map?.get(status) ??
    CASO_STATUS.find((s) => s.value === status)?.label ??
    status
  );
}

function foldText(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Strict area parse — unlike normalizeAreaProcesso, unknown text is rejected. */
function parseAreaProcesso(raw: string): FunilProcesso | null {
  const a = foldText(raw);
  if (!a) return null;
  if (a.includes("civ")) return "civel";
  if (a.startsWith("prev")) return "previdenciario";
  return null;
}

/** Accepts situação chave or label; "" / null / limpar → null. */
function parseSituacao(
  raw: unknown
): { ok: true; value: SituacaoProcesso | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const f = foldText(raw);
  if (!f || ["nenhuma", "limpar", "sem situacao", "null"].includes(f)) {
    return { ok: true, value: null };
  }
  const hit = SITUACOES_PROCESSO.find(
    (s) => s.value === f || foldText(s.label) === f
  );
  return hit ? { ok: true, value: hit.value } : { ok: false };
}

function situacaoLabel(v: string | null): string {
  if (!v) return "sem situação";
  return SITUACOES_PROCESSO.find((s) => s.value === v)?.label ?? v;
}

const SITUACOES_OPTIONS = SITUACOES_PROCESSO.map(
  (s) => `${s.value} (${s.label})`
).join("; ");

function matchColunaProcesso(
  raw: string,
  colunas: ProcessoColunaMatch[]
): ProcessoColunaMatch | null {
  const f = foldText(raw);
  if (!f) return null;
  return (
    colunas.find((c) => c.chave === raw.trim()) ??
    colunas.find((c) => foldText(c.chave) === f || foldText(c.label) === f) ??
    null
  );
}

function colunasOptions(colunas: ProcessoColunaMatch[]): string {
  return colunas.map((c) => `${c.chave} (${c.label})`).join("; ");
}

type ProcessoRow = {
  id: number;
  nome: string | null;
  cpf: string | null;
  telefone: string | null;
  numero_processo: string | null;
  area: string | null;
  funil_coluna: string | null;
  beneficio_identificado: string | null;
  parceiro_id: string | null;
};

const PROCESSO_SELECT =
  "id, nome, cpf, telefone, numero_processo, area, funil_coluna, beneficio_identificado, parceiro_id";

async function fetchProcessos(ids: number[]): Promise<ProcessoRow[]> {
  if (!ids.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("processos_clientes")
    .select(PROCESSO_SELECT)
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProcessoRow[];
}

function processoLine(p: ProcessoRow): string {
  const numero = p.numero_processo
    ? formatNumeroProcesso(p.numero_processo)
    : "sem número";
  return `#${p.id} · ${numero} · ${p.nome?.trim() || "sem nome"}`;
}

function parseIdList(args: Record<string, unknown>): number[] {
  const raw = args.processo_ids ?? args.ids ?? args.processo_id;
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const out = new Set<number>();
  for (const v of list) {
    const n = optionalPositiveId(v);
    if (n != null) out.add(n);
  }
  return [...out];
}

async function loadProcessosOrErr(
  ids: number[]
): Promise<{ rows: ProcessoRow[] } | ProposeErr> {
  if (!ids.length) {
    return {
      ok: false,
      summary:
        "Informe processo_ids (IDs de processos_clientes vindos de busca — nunca invente).",
    };
  }
  const rows = await fetchProcessos(ids);
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    return {
      ok: false,
      summary: `Processo(s) não encontrado(s): ${missing.map((id) => `#${id}`).join(", ")}. Busque de novo (listar_processos / obter_ficha).`,
    };
  }
  return { rows: ids.map((id) => rows.find((r) => r.id === id)!) };
}

async function parceiroExists(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_parceiros")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  return Boolean(data);
}

function isDataAndamento(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{2}\/\d{2}\/\d{4}$/.test(v);
}

function prazoTipoLabel(tipo: string): string {
  return PRAZO_TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
}

const DEFAULT_HORA_PRAZO = "08:00";
const DEFAULT_LEMBRETES_SUMMARY = "1 hora antes, na hora";

function lembretesSummaryLine(lembretes?: LembreteInput[]): string {
  if (!lembretes?.length) return DEFAULT_LEMBRETES_SUMMARY;
  return [...lembretes]
    .sort((a, b) => b.offset_minutes - a.offset_minutes)
    .map((l) => l.label?.trim() || labelForOffset(l.offset_minutes))
    .join(", ");
}

function parseOptionalLembretes(
  args: Record<string, unknown>
): { lembretes?: LembreteInput[]; err?: string } {
  const raw = args.lembretes;
  if (raw == null) return {};
  if (!Array.isArray(raw)) {
    return { err: "lembretes deve ser um array." };
  }
  if (raw.length === 0) return {};
  const seen = new Set<number>();
  const out: LembreteInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const offset = Math.max(0, Math.floor(Number(rec.offset_minutes)));
    if (!Number.isFinite(offset) || seen.has(offset)) continue;
    seen.add(offset);
    const label = str(rec.label) || undefined;
    out.push({
      offset_minutes: offset,
      ...(label ? { label } : {}),
    });
  }
  if (!out.length) {
    return {
      err: "lembretes inválidos — informe offset_minutes (0 = na hora).",
    };
  }
  return { lembretes: out };
}

type ProposeOk = {
  ok: true;
  normalizedArgs: Record<string, unknown>;
  label: string;
  summary: string;
  /** Extra lines for the confirmation card (e.g. affected processos). */
  details?: string[];
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

  const horaRaw = str(args.hora_prazo);
  const hora_prazo = horaRaw
    ? /^\d{1,2}:\d{2}(:\d{2})?$/.test(horaRaw)
      ? horaRaw
      : null
    : DEFAULT_HORA_PRAZO;
  if (horaRaw && !hora_prazo) {
    return { ok: false, summary: "hora_prazo deve ser HH:MM." };
  }

  const lembretesParsed = parseOptionalLembretes(args);
  if (lembretesParsed.err) {
    return { ok: false, summary: lembretesParsed.err };
  }
  const lembretes = lembretesParsed.lembretes;

  const cpf = optionalCpf(args.cpf);
  const caso_id = optionalPositiveId(args.caso_id);
  const processo_id = optionalPositiveId(args.processo_id);
  const descricao = str(args.descricao) || undefined;

  const local = str(args.local) || undefined;
  const modalidadeRaw = foldText(str(args.modalidade));
  let modalidade: ModalidadeAudiencia | undefined;
  if (modalidadeRaw) {
    if (!isModalidadeAudiencia(modalidadeRaw)) {
      return {
        ok: false,
        summary: `modalidade inválida. Use: ${MODALIDADES_AUDIENCIA.map((m) => m.value).join(" | ")}.`,
      };
    }
    modalidade = modalidadeRaw;
  }
  const link_audiencia = str(args.link_audiencia) || undefined;
  if (link_audiencia && !/^https?:\/\//i.test(link_audiencia)) {
    return {
      ok: false,
      summary: "link_audiencia deve começar com http:// ou https://.",
    };
  }

  const audienciaParts = [
    modalidade
      ? MODALIDADES_AUDIENCIA.find((m) => m.value === modalidade)?.label
      : null,
    local ? `local: ${local}` : null,
    link_audiencia ? `link: ${link_audiencia}` : null,
  ].filter(Boolean);

  return {
    ok: true,
    normalizedArgs: {
      titulo,
      tipo,
      data_prazo,
      hora_prazo: hora_prazo ?? DEFAULT_HORA_PRAZO,
      ...(descricao ? { descricao } : {}),
      ...(cpf ? { cpf } : {}),
      ...(caso_id != null ? { caso_id } : {}),
      ...(processo_id != null ? { processo_id } : {}),
      ...(lembretes?.length ? { lembretes } : {}),
      ...(local ? { local } : {}),
      ...(modalidade ? { modalidade } : {}),
      ...(link_audiencia ? { link_audiencia } : {}),
    },
    label: `Prazo: ${titulo}`,
    summary:
      `Criar prazo "${titulo}" (${prazoTipoLabel(tipo)}) em ${data_prazo} às ${String(hora_prazo).slice(0, 5)} · lembretes: ${lembretesSummaryLine(lembretes)}` +
      (audienciaParts.length ? ` · ${audienciaParts.join(" · ")}` : "") +
      ".",
  };
}

async function proposeMoverKanban(
  args: Record<string, unknown>
): Promise<ProposeOk | ProposeErr> {
  const caso_id = num(args.caso_id) ?? num(args.id);
  const status = str(args.status);
  if (caso_id == null) return { ok: false, summary: "Informe caso_id." };
  const colunas = await loadKanbanColunasMap();
  if (!colunas.has(status)) {
    return {
      ok: false,
      summary: `Coluna inválida ou inativa no funil de vendas: "${status}". Use uma destas chaves: ${kanbanColunasOptions(colunas)}.`,
    };
  }
  const supabase = await createClient();
  const { data: caso } = await supabase
    .from("casos_novos")
    .select("id, nome")
    .eq("id", caso_id)
    .maybeSingle();
  if (!caso) {
    return {
      ok: false,
      summary: `Caso #${caso_id} não encontrado. Busque de novo — nunca invente caso_id.`,
    };
  }
  const label = statusLabel(status, colunas);
  const nome = caso.nome?.trim();
  return {
    ok: true,
    normalizedArgs: { caso_id, status, status_label: label },
    label: `Kanban #${caso_id}${nome ? ` (${nome})` : ""} → ${label}`,
    summary: `Mover caso #${caso_id}${nome ? ` (${nome})` : ""} para "${label}".`,
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

  const caso_id = optionalPositiveId(args.caso_id);
  const processo_id = optionalPositiveId(args.processo_id);
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

async function proposeCriarClienteCaso(
  args: Record<string, unknown>
): Promise<ProposeOk | ProposeErr> {
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
  const colunas = await loadKanbanColunasMap();
  if (!statusRaw || !colunas.has(statusRaw)) {
    return {
      ok: false,
      summary: `Informe uma coluna válida do funil de vendas antes de criar. Opções: ${kanbanColunasOptions(colunas)}. Pergunte ao usuário e chame de novo com status.`,
    };
  }
  const status = statusRaw as CasoStatus;
  const statusNome = statusLabel(status, colunas);

  const cpfRaw = str(args.cpf);
  const cpf = cpfRaw ? normalizeCpf(cpfRaw) : "";
  if (cpf && (cpf.length !== 11 || !isValidCpf(cpf))) {
    return {
      ok: false,
      summary:
        "CPF inválido (dígitos verificadores). Peça ao usuário o CPF correto e chame criar_cliente_caso de novo — não diga que já criou.",
    };
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
    `funil ${statusNome}`,
  ].filter(Boolean);

  return {
    ok: true,
    normalizedArgs: {
      nome,
      telefone,
      status,
      status_label: statusNome,
      ...(cpf ? { cpf } : {}),
      ...(beneficio ? { beneficio_identificado: beneficio } : {}),
      ...(tipo_segurado ? { tipo_segurado } : {}),
      ...(area ? { area } : {}),
    },
    label: `Criar cliente: ${nome} → ${statusNome}`,
    summary: `Criar cliente/caso: ${parts.join(" · ")}.`,
  };
}

const PROCESSO_TEXT_KEYS = [
  "telefone",
  "tribunal",
  "polo_ativo",
  "polo_passivo",
  "tipo_acao",
  "vara_comarca",
  "processo_origem",
  "ultimo_movimento",
  "observacao",
  "beneficio_identificado",
] as const;

const PROCESSO_FIELD_LABELS: Record<string, string> = {
  nome: "Nome",
  cpf: "CPF",
  numero_processo: "Número",
  area: "Área",
  funil_coluna: "Coluna",
  telefone: "Telefone",
  tribunal: "Tribunal",
  polo_ativo: "Polo ativo",
  polo_passivo: "Polo passivo",
  tipo_acao: "Tipo de ação",
  vara_comarca: "Vara/comarca",
  valor_centavos: "Valor",
  processo_origem: "Processo de origem",
  situacao: "Situação",
  ultimo_andamento_data: "Último andamento",
  ultimo_movimento: "Último movimento",
  observacao: "Observação",
  beneficio_identificado: "Benefício",
  parceiro_id: "Parceiro",
};

type ProcessoFields = Partial<Omit<UpsertProcessoInput, "id">>;

function hasArg(args: Record<string, unknown>, key: string): boolean {
  return key in args && args[key] !== undefined;
}

/**
 * Validates processo fields. `update` = only keys present in args, empty
 * clears; create = empty values are skipped. Coluna is resolved by callers
 * (depends on the target funil).
 */
async function parseProcessoFields(
  args: Record<string, unknown>,
  update: boolean
): Promise<{ ok: true; fields: ProcessoFields } | ProposeErr> {
  const fields: ProcessoFields = {};

  if (!update || hasArg(args, "nome")) {
    const nome = str(args.nome);
    if (!nome) return { ok: false, summary: "Informe o nome do cliente." };
    fields.nome = nome;
  }
  if (!update || hasArg(args, "cpf")) {
    const cpf = normalizeCpf(str(args.cpf));
    if (cpf.length !== 11 || !isValidCpf(cpf)) {
      return {
        ok: false,
        summary:
          "CPF inválido (dígitos verificadores). Peça o CPF correto ao usuário.",
      };
    }
    fields.cpf = cpf;
  }
  if (!update || hasArg(args, "numero_processo")) {
    const numero = str(args.numero_processo);
    if (!isValidNumeroProcesso(numero)) {
      return {
        ok: false,
        summary: "numero_processo inválido — o número CNJ tem 20 dígitos.",
      };
    }
    fields.numero_processo = normalizeNumeroProcesso(numero);
  }
  if (!update || hasArg(args, "area")) {
    const area = parseAreaProcesso(str(args.area));
    if (!area) {
      return { ok: false, summary: "area inválida. Use: previdenciario | civel." };
    }
    fields.area = area;
  }

  for (const key of PROCESSO_TEXT_KEYS) {
    if (!hasArg(args, key)) continue;
    const v = str(args[key]);
    if (v) fields[key] = v;
    else if (update) fields[key] = null;
  }

  const valorKey = hasArg(args, "valor")
    ? "valor"
    : hasArg(args, "valor_reais")
      ? "valor_reais"
      : null;
  if (valorKey) {
    const raw = args[valorKey];
    const empty = raw === null || (typeof raw === "string" && !raw.trim());
    if (empty) {
      if (update) fields.valor_centavos = null;
    } else {
      const centavos =
        typeof raw === "number" || typeof raw === "string"
          ? parseValorReais(raw)
          : null;
      if (centavos == null) {
        return {
          ok: false,
          summary: "valor inválido — informe em reais (ex.: 11.239,05).",
        };
      }
      fields.valor_centavos = centavos;
    }
  }

  if (hasArg(args, "situacao") || args.situacao === null) {
    const sit = parseSituacao(args.situacao);
    if (!sit.ok) {
      return {
        ok: false,
        summary: `situacao inválida. Use: ${SITUACOES_OPTIONS} (ou vazio para limpar).`,
      };
    }
    if (sit.value || update) fields.situacao = sit.value;
  }

  if (hasArg(args, "ultimo_andamento_data")) {
    const d = str(args.ultimo_andamento_data);
    if (d && !isDataAndamento(d)) {
      return {
        ok: false,
        summary: "ultimo_andamento_data deve ser yyyy-mm-dd ou dd/mm/aaaa.",
      };
    }
    if (d) fields.ultimo_andamento_data = d;
    else if (update) fields.ultimo_andamento_data = null;
  }

  if (hasArg(args, "parceiro_id")) {
    const pid = str(args.parceiro_id);
    if (pid) {
      if (!(await parceiroExists(pid))) {
        return {
          ok: false,
          summary: `Parceiro ${pid} não encontrado — nunca invente parceiro_id.`,
        };
      }
      fields.parceiro_id = pid;
    } else if (update) {
      fields.parceiro_id = null;
    }
  }

  return { ok: true, fields };
}

function processoFieldDetails(
  fields: ProcessoFields,
  colunaLabel?: string | null
): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const label = PROCESSO_FIELD_LABELS[key] ?? key;
    let text: string;
    if (value === null || value === "") text = "(limpar)";
    else if (key === "area") text = labelFunilProcesso(String(value));
    else if (key === "funil_coluna") text = colunaLabel || String(value);
    else if (key === "valor_centavos") text = formatValorCentavos(Number(value));
    else if (key === "situacao") text = situacaoLabel(String(value));
    else if (key === "numero_processo") text = formatNumeroProcesso(String(value));
    else if (key === "cpf") text = formatCpf(String(value));
    else text = String(value);
    out.push(`${label}: ${text}`);
  }
  return out;
}

async function resolveColunaArg(
  args: Record<string, unknown>,
  funil: FunilProcesso
): Promise<
  { ok: true; coluna: ProcessoColunaMatch | null } | ProposeErr
> {
  const raw = str(args.coluna) || str(args.funil_coluna);
  if (!raw) return { ok: true, coluna: null };
  const colunas = await listProcessoColunas(funil);
  const coluna = matchColunaProcesso(raw, colunas);
  if (!coluna) {
    return {
      ok: false,
      summary: `Coluna "${raw}" não existe no funil ${labelFunilProcesso(funil)}. Use: ${colunasOptions(colunas)}.`,
    };
  }
  return { ok: true, coluna };
}

async function proposeCriarProcesso(
  args: Record<string, unknown>
): Promise<ProposeOk | ProposeErr> {
  const parsed = await parseProcessoFields(args, false);
  if (!parsed.ok) return parsed;
  const fields = parsed.fields;
  const funil = fields.area as FunilProcesso;

  if (funil === "civel" && fields.beneficio_identificado) {
    return {
      ok: false,
      summary:
        "Benefício só se aplica ao funil Previdenciário. Remova beneficio_identificado ou use area=previdenciario.",
    };
  }

  const col = await resolveColunaArg(args, funil);
  if (!col.ok) return col;
  if (col.coluna) fields.funil_coluna = col.coluna.chave;

  const supabase = await createClient();
  const { data: dup } = await supabase
    .from("processos_clientes")
    .select("id, nome")
    .eq("numero_processo", fields.numero_processo!)
    .limit(1)
    .maybeSingle();
  if (dup) {
    return {
      ok: false,
      summary: `Já existe o processo #${dup.id} com este número (${dup.nome ?? "sem nome"}). Use atualizar_processo com processo_id=${dup.id}.`,
    };
  }

  const numeroFmt = formatNumeroProcesso(fields.numero_processo!);
  const details = processoFieldDetails(fields, col.coluna?.label);
  if (!col.coluna) details.push("Coluna: primeira coluna do funil");

  return {
    ok: true,
    normalizedArgs: {
      fields,
      funil,
      ...(col.coluna ? { coluna_label: col.coluna.label } : {}),
    },
    label: `Criar processo ${numeroFmt} (${fields.nome}) · ${labelFunilProcesso(funil)}`,
    summary: `Criar processo ${numeroFmt} para ${fields.nome} no funil ${labelFunilProcesso(funil)}${col.coluna ? ` → ${col.coluna.label}` : ""}.`,
    details,
  };
}

async function proposeAtualizarProcesso(
  args: Record<string, unknown>
): Promise<ProposeOk | ProposeErr> {
  const processo_id = optionalPositiveId(args.processo_id ?? args.id);
  if (processo_id == null) {
    return { ok: false, summary: "Informe processo_id (de busca — nunca invente)." };
  }
  const loaded = await loadProcessosOrErr([processo_id]);
  if ("ok" in loaded) return loaded;
  const existing = loaded.rows[0]!;

  const parsed = await parseProcessoFields(args, true);
  if (!parsed.ok) return parsed;
  const fields = parsed.fields;

  const funil = fields.area ?? normalizeAreaProcesso(existing.area);
  const col = await resolveColunaArg(args, funil as FunilProcesso);
  if (!col.ok) return col;
  if (col.coluna) fields.funil_coluna = col.coluna.chave;

  if (funil === "civel" && fields.beneficio_identificado) {
    return {
      ok: false,
      summary: "Benefício só se aplica ao funil Previdenciário.",
    };
  }

  if (fields.numero_processo && fields.numero_processo !== existing.numero_processo) {
    const supabase = await createClient();
    const { data: dup } = await supabase
      .from("processos_clientes")
      .select("id")
      .eq("numero_processo", fields.numero_processo)
      .neq("id", processo_id)
      .limit(1)
      .maybeSingle();
    if (dup) {
      return {
        ok: false,
        summary: `O número informado já pertence ao processo #${dup.id}.`,
      };
    }
  }

  if (!Object.keys(fields).length) {
    return { ok: false, summary: "Informe ao menos um campo para atualizar." };
  }

  const details = processoFieldDetails(fields, col.coluna?.label);
  if (fields.area && fields.area !== normalizeAreaProcesso(existing.area) && !col.coluna) {
    details.push("Coluna: primeira coluna do novo funil");
  }

  return {
    ok: true,
    normalizedArgs: { processo_id, fields },
    label: `Atualizar processo ${processoLine(existing)}`,
    summary: `Atualizar processo ${processoLine(existing)}: ${details.join("; ")}.`,
    details,
  };
}

async function proposeMoverProcesso(
  args: Record<string, unknown>
): Promise<ProposeOk | ProposeErr> {
  const loaded = await loadProcessosOrErr(parseIdList(args));
  if ("ok" in loaded) return loaded;
  const rows = loaded.rows;

  const funis = new Set(rows.map((r) => normalizeAreaProcesso(r.area)));
  if (funis.size > 1) {
    return {
      ok: false,
      summary:
        "Os processos são de funis diferentes (Previdenciário e Cível). Mova cada funil em uma chamada separada.",
    };
  }
  const [funil] = [...funis] as [FunilProcesso];

  const raw = str(args.coluna) || str(args.funil_coluna);
  if (!raw) return { ok: false, summary: "Informe a coluna de destino." };
  const col = await resolveColunaArg({ coluna: raw }, funil);
  if (!col.ok) return col;
  const coluna = col.coluna!;

  const details = rows.map(
    (r) =>
      processoLine(r) +
      (r.funil_coluna === coluna.chave ? " (já está nesta coluna)" : "")
  );
  const n = rows.length;

  return {
    ok: true,
    normalizedArgs: {
      processo_ids: rows.map((r) => r.id),
      coluna: coluna.chave,
      coluna_label: coluna.label,
      funil,
    },
    label:
      n === 1
        ? `Mover processo ${processoLine(rows[0]!)} → ${coluna.label}`
        : `Mover ${n} processos → ${coluna.label}`,
    summary: `Mover ${n} processo(s) do funil ${labelFunilProcesso(funil)} para "${coluna.label}": ${details.join("; ")}.`,
    details,
  };
}

async function proposeDefinirSituacaoProcesso(
  args: Record<string, unknown>
): Promise<ProposeOk | ProposeErr> {
  if (!("situacao" in args)) {
    return {
      ok: false,
      summary: `Informe situacao (${SITUACOES_OPTIONS}) ou null para limpar.`,
    };
  }
  const sit = parseSituacao(args.situacao);
  if (!sit.ok) {
    return {
      ok: false,
      summary: `situacao inválida. Use: ${SITUACOES_OPTIONS} (ou null para limpar).`,
    };
  }
  const loaded = await loadProcessosOrErr(parseIdList(args));
  if ("ok" in loaded) return loaded;
  const rows = loaded.rows;
  const label = situacaoLabel(sit.value);
  const details = rows.map(processoLine);
  const n = rows.length;
  const verb = sit.value ? `Definir situação "${label}"` : "Limpar situação";

  return {
    ok: true,
    normalizedArgs: {
      processo_ids: rows.map((r) => r.id),
      situacao: sit.value,
      situacao_label: label,
    },
    label:
      n === 1
        ? `${verb} · ${processoLine(rows[0]!)}`
        : `${verb} · ${n} processos`,
    summary: `${verb} em ${n} processo(s): ${details.join("; ")}.`,
    details,
  };
}

async function proposeExcluirProcesso(
  args: Record<string, unknown>
): Promise<ProposeOk | ProposeErr> {
  let user;
  try {
    user = await getAppUser();
  } catch {
    return { ok: false, summary: "Não autenticado." };
  }
  if (!user) return { ok: false, summary: "Não autenticado." };
  if (user.papel !== "advogado") {
    return {
      ok: false,
      summary:
        "Só advogado pode excluir processos. Explique isso ao usuário; não tente de novo.",
    };
  }

  const ids = parseIdList(args);
  if (ids.length > 1) {
    return { ok: false, summary: "Exclua um processo por vez (processo_id)." };
  }
  const loaded = await loadProcessosOrErr(ids);
  if ("ok" in loaded) return loaded;
  const p = loaded.rows[0]!;
  const numero = p.numero_processo
    ? formatNumeroProcesso(p.numero_processo)
    : `#${p.id}`;
  const nome = p.nome?.trim() || "sem nome";
  const funil = normalizeAreaProcesso(p.area);

  return {
    ok: true,
    normalizedArgs: {
      processo_id: p.id,
      numero_processo: numero,
      nome,
      funil,
      ...(p.cpf ? { cpf: p.cpf } : {}),
    },
    label: `Excluir processo ${numero} (${nome})`,
    summary: `EXCLUIR definitivamente o processo ${numero} de ${nome} (${labelFunilProcesso(funil)}). Prazos e documentos vinculados perdem o vínculo.`,
    details: [
      `Processo: ${numero}`,
      `Cliente: ${nome}${p.cpf ? ` · CPF ${formatCpf(p.cpf)}` : ""}`,
      `Funil: ${labelFunilProcesso(funil)}`,
      "Ação irreversível.",
    ],
  };
}

type PromptEditPreview = {
  before: string;
  after: string;
  modo: string;
  secao: string | null;
  linha: number | null;
  alteracoes: PromptEditPreviewItem[];
};

type ProposeOkWithPreview = ProposeOk & {
  preview: PromptEditPreview;
};

function formatLocalPrompt(
  secao: string | null,
  linha: number | null
): string {
  const parts: string[] = [];
  if (secao) parts.push(`seção ${secao}`);
  if (linha != null && linha > 0) parts.push(`~linha ${linha}`);
  return parts.length ? parts.join(", ") : "documento";
}

function docLabel(doc: string): string {
  return doc === "mensagem_abertura" ? "abertura" : "persona";
}

function parseAlteracoesArgs(
  args: Record<string, unknown>
): PromptEditAlteracaoInput[] | { error: string } {
  const rawList = args.alteracoes;
  if (Array.isArray(rawList) && rawList.length > 0) {
    const out: PromptEditAlteracaoInput[] = [];
    for (let i = 0; i < rawList.length; i++) {
      const item = asRecord(rawList[i]);
      const documento = parsePromptDocumento(str(item.documento));
      if (!documento) {
        return {
          error: `alteracoes[${i}]: documento inválido (use persona | mensagem_abertura).`,
        };
      }
      const modo = parsePromptEditModo(str(item.modo));
      if (!modo) {
        return {
          error: `alteracoes[${i}]: modo inválido. Use: substituir | inserir_apos | inserir_antes | substituir_tudo.`,
        };
      }
      const ancora = str(item.ancora) || str(item.trecho_atual);
      const trecho_novo =
        item.trecho_novo === undefined || item.trecho_novo === null
          ? undefined
          : String(item.trecho_novo);
      const texto_inserir =
        item.texto_inserir === undefined || item.texto_inserir === null
          ? undefined
          : String(item.texto_inserir);
      const motivo = str(item.motivo) || undefined;
      out.push({
        documento,
        modo,
        ...(ancora ? { ancora } : {}),
        ...(trecho_novo !== undefined ? { trecho_novo } : {}),
        ...(texto_inserir !== undefined ? { texto_inserir } : {}),
        ...(motivo ? { motivo } : {}),
      });
    }
    return out;
  }

  // Legacy single edit (defaults to persona).
  const modo = parsePromptEditModo(str(args.modo));
  if (!modo) {
    return {
      error:
        "Informe alteracoes[] (preferencial) ou modo legado. Modos: substituir | inserir_apos | inserir_antes | substituir_tudo.",
    };
  }
  const documento =
    parsePromptDocumento(str(args.documento) || "persona") ?? "persona";
  const ancora = str(args.ancora) || str(args.trecho_atual);
  const trecho_novo =
    args.trecho_novo === undefined || args.trecho_novo === null
      ? undefined
      : String(args.trecho_novo);
  const texto_inserir =
    args.texto_inserir === undefined || args.texto_inserir === null
      ? undefined
      : String(args.texto_inserir);
  return [
    {
      documento,
      modo,
      ...(ancora ? { ancora } : {}),
      ...(trecho_novo !== undefined ? { trecho_novo } : {}),
      ...(texto_inserir !== undefined ? { texto_inserir } : {}),
    },
  ];
}

async function proposeAlteracaoPromptAgente(
  args: Record<string, unknown>
): Promise<ProposeOkWithPreview | ProposeErr> {
  let user;
  try {
    user = await getAppUser();
  } catch {
    return { ok: false, summary: "Não autenticado." };
  }
  if (!user) return { ok: false, summary: "Não autenticado." };
  if (user.papel !== "advogado") {
    return {
      ok: false,
      summary:
        "Só advogado pode alterar o prompt do agente. Explique isso ao usuário; não invente alterações.",
    };
  }

  const parsed = parseAlteracoesArgs(args);
  if ("error" in parsed) return { ok: false, summary: parsed.error };

  const motivo = str(args.motivo) || "Alterar prompt do agente";

  let config;
  try {
    config = await getAgenteConfig();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao ler config do agente";
    if (/não autenticado|sem permissão|cookies/i.test(msg)) {
      return {
        ok: false,
        summary:
          msg.toLowerCase().includes("permissão")
            ? "Só advogado pode alterar o prompt do agente."
            : "Não autenticado.",
      };
    }
    return { ok: false, summary: msg };
  }
  if (!config) {
    return { ok: false, summary: "Configuração do agente não encontrada." };
  }

  const applied = applyPromptEditsBatch({
    persona: config.persona,
    mensagem_abertura: config.mensagem_abertura,
    alteracoes: parsed,
  });
  if (!applied.ok) return applied;

  const label = motivo.length > 80 ? `${motivo.slice(0, 77)}…` : motivo;
  const n = applied.previews.length;
  const locs = applied.previews
    .map((p) => {
      const loc = formatLocalPrompt(p.secao, p.linha);
      return `${docLabel(p.documento)} (${p.modo}, ${loc})`;
    })
    .join("; ");

  const first = applied.previews[0]!;
  const summaryParts = applied.previews.map((p, i) => {
    const loc = formatLocalPrompt(p.secao, p.linha);
    return `${i + 1}) ${docLabel(p.documento)} ${p.modo} @ ${loc}: «${clipPreview(p.before, 80)}» → «${clipPreview(p.after, 80)}»`;
  });

  return {
    ok: true,
    normalizedArgs: {
      persona: applied.persona,
      mensagem_abertura: applied.mensagem_abertura,
      motivo: label,
      alteracoes_count: n,
    },
    label:
      n > 1
        ? `Rascunho prompt (${n} alterações): ${label}`
        : `Rascunho prompt (${first.modo}): ${label}`,
    summary: `Salvar no rascunho — ${n} alteração(ões): ${locs}. ${summaryParts.join(" ")}. Não publica — publique em Configurações → Agente.`,
    preview: {
      before: first.before,
      after: first.after,
      modo: n > 1 ? `lote(${n})` : first.modo,
      secao: first.secao,
      linha: first.linha,
      alteracoes: applied.previews,
    },
  };
}

async function proposeWrite(
  name: Exclude<
    AssistenteWriteToolName,
    "propor_alteracao_prompt_agente" | "reverter_prompt_agente"
  >,
  args: Record<string, unknown>,
  pendingAnexo?: AssistentePendingAnexo | null
): Promise<ProposeOk | ProposeErr> {
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
    case "criar_processo":
      return proposeCriarProcesso(args);
    case "atualizar_processo":
      return proposeAtualizarProcesso(args);
    case "mover_processo":
      return proposeMoverProcesso(args);
    case "definir_situacao_processo":
      return proposeDefinirSituacaoProcesso(args);
    case "excluir_processo":
      return proposeExcluirProcesso(args);
  }
}

async function proposeReverterPromptAgente(
  args: Record<string, unknown>
): Promise<ProposeOkWithPreview | ProposeErr> {
  let user;
  try {
    user = await getAppUser();
  } catch {
    return { ok: false, summary: "Não autenticado." };
  }
  if (!user) return { ok: false, summary: "Não autenticado." };
  if (user.papel !== "advogado") {
    return {
      ok: false,
      summary:
        "Só advogado pode reverter o prompt do agente. Explique isso ao usuário; não invente alterações.",
    };
  }

  const versao_id = str(args.versao_id) || str(args.id);
  if (!versao_id) {
    return {
      ok: false,
      summary:
        "versao_id obrigatório. Use ler_versoes_prompt_agente e passe o id da versão.",
    };
  }

  let versao;
  try {
    versao = await getAgenteConfigVersao(versao_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao ler versão";
    if (/não autenticado|sem permissão/i.test(msg)) {
      return {
        ok: false,
        summary: msg.toLowerCase().includes("permissão")
          ? "Só advogado pode reverter o prompt do agente."
          : "Não autenticado.",
      };
    }
    return { ok: false, summary: msg };
  }
  if (!versao) {
    return { ok: false, summary: `Versão ${versao_id} não encontrada.` };
  }

  const motivo =
    str(args.motivo) ||
    `Reverter para snapshot ${versao.id.slice(0, 8)}… (${versao.publicado ? "publicado" : "rascunho"})`;
  const label = motivo.length > 80 ? `${motivo.slice(0, 77)}…` : motivo;
  const excerptPersona = clipPreview(versao.persona, 160);
  const excerptAbertura = clipPreview(versao.mensagem_abertura, 120);

  return {
    ok: true,
    normalizedArgs: {
      persona: versao.persona,
      mensagem_abertura: versao.mensagem_abertura,
      versao_id: versao.id,
      motivo: label,
    },
    label: `Reverter rascunho: ${label}`,
    summary: `Restaurar no RASCUNHO a versão ${versao.id.slice(0, 8)}… (${versao.publicado ? "publicado" : "rascunho"}, ${versao.fonte}): persona «${excerptPersona}»; abertura «${excerptAbertura}». Não publica — publique em Configurações → Agente.`,
    preview: {
      before: excerptPersona,
      after: excerptPersona,
      modo: "reverter",
      secao: null,
      linha: null,
      alteracoes: [
        {
          documento: "persona",
          before: excerptPersona,
          after: excerptPersona,
          modo: "reverter",
          secao: null,
          linha: null,
        },
        {
          documento: "mensagem_abertura",
          before: excerptAbertura || "(vazio)",
          after: excerptAbertura || "(vazio)",
          modo: "reverter",
          secao: null,
          linha: null,
        },
      ],
    },
  };
}

/** Validates args and returns a pending-confirmation result (does not mutate). */
export async function proposeAssistenteWriteTool(
  name: AssistenteWriteToolName,
  rawArgs: unknown,
  opts?: { pendingAnexo?: AssistentePendingAnexo | null }
): Promise<AssistenteToolResult> {
  const args = asRecord(rawArgs);

  if (
    name === "propor_alteracao_prompt_agente" ||
    name === "reverter_prompt_agente"
  ) {
    const proposed =
      name === "propor_alteracao_prompt_agente"
        ? await proposeAlteracaoPromptAgente(args)
        : await proposeReverterPromptAgente(args);
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
      data: {
        normalizedArgs: proposed.normalizedArgs,
        // Flat preview fields for UI + model (before/after/secao/modo/linha).
        before: proposed.preview.before,
        after: proposed.preview.after,
        secao: proposed.preview.secao,
        modo: proposed.preview.modo,
        linha: proposed.preview.linha,
        alteracoes: proposed.preview.alteracoes,
        preview: proposed.preview,
      },
      links: [
        { label: "Configurações → Agente", href: "/configuracoes" },
      ],
    };
  }

  let proposed: ProposeOk | ProposeErr;
  try {
    proposed = await proposeWrite(name, args, opts?.pendingAnexo);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao validar ação";
    return { ok: false, summary: msg };
  }
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
    data: {
      normalizedArgs: proposed.normalizedArgs,
      ...(proposed.details?.length ? { details: proposed.details } : {}),
    },
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
  const hora_prazo = str(args.hora_prazo) || DEFAULT_HORA_PRAZO;
  const cpf = optionalCpf(args.cpf);
  const lembretesParsed = parseOptionalLembretes(args);
  const lembretes = lembretesParsed.lembretes;
  // Never pass empty/invalid FKs — inventing or "" breaks app_prazos_*_fkey.
  const links = await verifiedPrazoLinks({
    caso_id: optionalPositiveId(args.caso_id),
    processo_id: optionalPositiveId(args.processo_id),
  });
  const local = str(args.local) || undefined;
  const modalidadeRaw = str(args.modalidade);
  const modalidade = isModalidadeAudiencia(modalidadeRaw)
    ? modalidadeRaw
    : undefined;
  const link_audiencia = str(args.link_audiencia) || undefined;
  await criarPrazo({
    titulo,
    tipo,
    data_prazo,
    hora_prazo,
    descricao: str(args.descricao) || undefined,
    ...(cpf ? { cpf } : {}),
    ...links,
    ...(lembretes?.length ? { lembretes } : {}),
    ...(local ? { local } : {}),
    ...(modalidade ? { modalidade } : {}),
    ...(link_audiencia ? { link_audiencia } : {}),
  });

  const isAudiencia = tipo === "audiencia";
  return {
    ok: true,
    summary: `${isAudiencia ? "Audiência" : "Prazo"} "${titulo}" ${isAudiencia ? "criada" : "criado"} para ${data_prazo} às ${hora_prazo.slice(0, 5)}.${isAudiencia ? ` Link: ${audienciasHref()}.` : ""}`,
    links: [
      ...(cpf
        ? [{ label: "Abrir ficha", href: assistenteFichaHref({ cpf }) }]
        : []),
      isAudiencia
        ? { label: "Ver audiências", href: audienciasHref() }
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
      `Caso #${caso_id} movido para "${str(args.status_label) || statusLabel(status)}".` +
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
  const links = await verifiedPrazoLinks({
    caso_id: optionalPositiveId(args.caso_id),
    processo_id: optionalPositiveId(args.processo_id),
  });
  const caso_id = links.caso_id;
  const processo_id = links.processo_id;
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
  if (!statusRaw || !(await loadKanbanColunasMap()).has(statusRaw)) {
    return {
      ok: false,
      summary: `Coluna do funil de vendas inválida ou inativa: "${statusRaw}". Use listar_colunas_funis.`,
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
    summary: `${verb}: ${result.nome} (caso #${result.casoId}, ${result.status === status ? str(args.status_label) || statusLabel(result.status) : statusLabel(result.status)}). Links: ficha ${result.href}, kanban ${assistenteKanbanHref(result.casoId)}.`,
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

function processoLinks(
  funil: FunilProcesso,
  cpf?: string | null
): { label: string; href: string }[] {
  return [
    ...(cpf ? [{ label: "Abrir ficha", href: assistenteFichaHref({ cpf }) }] : []),
    {
      label: `Processos ${labelFunilProcesso(funil)}`,
      href: processosFunilHref(funil),
    },
  ];
}

async function execCriarProcesso(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const fields = asRecord(args.fields) as ProcessoFields;
  if (!fields.nome || !fields.cpf || !fields.numero_processo) {
    return { ok: false, summary: "Dados incompletos para criar o processo." };
  }
  await upsertProcesso({
    ...fields,
    nome: fields.nome,
    cpf: fields.cpf,
    numero_processo: fields.numero_processo,
  });

  const funil = normalizeAreaProcesso(fields.area);
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("processos_clientes")
    .select("id, funil_coluna")
    .eq("numero_processo", fields.numero_processo)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const numeroFmt = formatNumeroProcesso(fields.numero_processo);
  const funilLinks = processoLinks(funil, fields.cpf);

  return {
    ok: true,
    summary: `Processo ${numeroFmt} criado para ${fields.nome}${row ? ` (#${row.id})` : ""} no funil ${labelFunilProcesso(funil)}. Links: ${funilLinks.map((l) => l.href).join(", ")}.`,
    links: funilLinks,
    data: row ? { processo_id: row.id, funil_coluna: row.funil_coluna } : undefined,
  };
}

async function execAtualizarProcesso(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const processo_id = optionalPositiveId(args.processo_id);
  if (processo_id == null) return { ok: false, summary: "processo_id ausente." };
  const [existing] = await fetchProcessos([processo_id]);
  if (!existing) return { ok: false, summary: `Processo #${processo_id} não encontrado.` };

  const fields = asRecord(args.fields) as ProcessoFields;
  // upsertProcesso always rewrites beneficio/parceiro — keep current values unless changed.
  await upsertProcesso({
    id: processo_id,
    nome: existing.nome ?? "",
    cpf: existing.cpf ?? "",
    numero_processo: existing.numero_processo ?? "",
    beneficio_identificado: existing.beneficio_identificado,
    parceiro_id: existing.parceiro_id,
    ...fields,
  });

  const funil = normalizeAreaProcesso(fields.area ?? existing.area);
  const cpf = fields.cpf ?? existing.cpf;
  const funilLinks = processoLinks(funil, cpf);
  return {
    ok: true,
    summary: `Processo ${processoLine({ ...existing, ...fields, id: processo_id } as ProcessoRow)} atualizado. Links: ${funilLinks.map((l) => l.href).join(", ")}.`,
    links: funilLinks,
  };
}

async function execMoverProcesso(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const ids = parseIdList(args);
  const coluna = str(args.coluna);
  if (!ids.length || !coluna) {
    return { ok: false, summary: "processo_ids e coluna são obrigatórios." };
  }
  const result = await moverProcessoColuna(ids, coluna);
  const funil = (str(args.funil) || "previdenciario") as FunilProcesso;
  const label = str(args.coluna_label) || coluna;
  return {
    ok: true,
    summary: `${result.count} processo(s) movido(s) para "${label}". Link: ${processosFunilHref(funil)}.`,
    links: [
      {
        label: `Processos ${labelFunilProcesso(funil)}`,
        href: processosFunilHref(funil),
      },
    ],
  };
}

async function execDefinirSituacaoProcesso(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const ids = parseIdList(args);
  if (!ids.length) return { ok: false, summary: "processo_ids ausente." };
  const situacao = str(args.situacao) || null;
  const result = await atualizarSituacaoProcesso(ids, situacao);
  const rows = await fetchProcessos(ids.slice(0, 1));
  const funil = normalizeAreaProcesso(rows[0]?.area);
  return {
    ok: true,
    summary: situacao
      ? `Situação "${situacaoLabel(situacao)}" definida em ${result.count} processo(s).`
      : `Situação removida de ${result.count} processo(s).`,
    links: [
      {
        label: `Processos ${labelFunilProcesso(funil)}`,
        href: processosFunilHref(funil),
      },
    ],
  };
}

async function execExcluirProcesso(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const processo_id = optionalPositiveId(args.processo_id);
  if (processo_id == null) return { ok: false, summary: "processo_id ausente." };
  await excluirProcesso(processo_id);
  const funil = (str(args.funil) || "previdenciario") as FunilProcesso;
  const cpf = str(args.cpf) || null;
  return {
    ok: true,
    summary: `Processo ${str(args.numero_processo) || `#${processo_id}`} (${str(args.nome) || "cliente"}) excluído.`,
    links: processoLinks(funil, cpf),
  };
}

async function execProporAlteracaoPromptAgente(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const persona = typeof args.persona === "string" ? args.persona : "";
  const mensagem_abertura =
    typeof args.mensagem_abertura === "string" ? args.mensagem_abertura : "";
  if (!persona.trim()) {
    return { ok: false, summary: "persona ausente na confirmação." };
  }

  const motivo = str(args.motivo);
  // Never publish — draft only.
  const saved = await salvarRascunhoAgente(
    { persona, mensagem_abertura },
    { fonte: "assistente", motivo: motivo || "Alteração via assistente" }
  );
  return {
    ok: true,
    summary:
      `Rascunho do prompt salvo` +
      (motivo ? ` (${motivo})` : "") +
      `. Ainda NÃO está publicado — publique em Configurações → Agente quando quiser. Versão publicada permanece ${saved.versao}.`,
    links: [
      { label: "Configurações → Agente", href: "/configuracoes" },
    ],
    data: {
      versao: saved.versao,
      published_at: saved.published_at,
      updated_at: saved.updated_at,
      rascunho_chars: saved.persona.length,
      preview: clipPreview(saved.persona, 160),
    },
  };
}

async function execReverterPromptAgente(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const persona = typeof args.persona === "string" ? args.persona : "";
  const mensagem_abertura =
    typeof args.mensagem_abertura === "string" ? args.mensagem_abertura : "";
  const versao_id = str(args.versao_id);
  if (!persona.trim()) {
    return { ok: false, summary: "persona ausente na confirmação de reversão." };
  }

  const motivo = str(args.motivo) || `Reverter ${versao_id || "versão"}`;
  // Never publish — draft only.
  const saved = await salvarRascunhoAgente(
    { persona, mensagem_abertura },
    { fonte: "reverter", motivo }
  );
  return {
    ok: true,
    summary:
      `Rascunho restaurado` +
      (versao_id ? ` a partir de ${versao_id.slice(0, 8)}…` : "") +
      `. Ainda NÃO está publicado — publique em Configurações → Agente quando quiser. Versão publicada permanece ${saved.versao}.`,
    links: [
      { label: "Configurações → Agente", href: "/configuracoes" },
    ],
    data: {
      versao_id: versao_id || null,
      versao: saved.versao,
      published_at: saved.published_at,
      updated_at: saved.updated_at,
      rascunho_chars: saved.persona.length,
      preview: clipPreview(saved.persona, 160),
    },
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
      case "criar_processo":
        return await execCriarProcesso(args);
      case "atualizar_processo":
        return await execAtualizarProcesso(args);
      case "mover_processo":
        return await execMoverProcesso(args);
      case "definir_situacao_processo":
        return await execDefinirSituacaoProcesso(args);
      case "excluir_processo":
        return await execExcluirProcesso(args);
      case "propor_alteracao_prompt_agente":
        return await execProporAlteracaoPromptAgente(args);
      case "reverter_prompt_agente":
        return await execReverterPromptAgente(args);
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
