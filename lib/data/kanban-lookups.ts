import { CASO_STATUS } from "@/lib/constants";
import type { CasoStatus, Tables } from "@/types/database";

type CasoLookup = Pick<Tables<"casos_novos">, "id" | "telefone" | "cpf">;

/** Status legado gravado pelo n8n → coluna equivalente do Kanban. */
const LEGACY_STATUS_MAP: Record<string, CasoStatus> = {
  aguardando_advogado: "abertura_processo",
  em_analise: "abertura_processo",
  processo_criado: "processo_finalizado",
  arquivado: "processo_finalizado",
};

/**
 * Normaliza status para chave de coluna.
 * Legado → mapeia; sistema/custom → mantém; vazio → em_atendimento.
 * Não força status desconhecido para "em_atendimento" (quebraria colunas personalizadas).
 */
export function normalizeCasoStatus(
  status: string | null | undefined
): string {
  if (!status?.trim()) return "em_atendimento";
  const trimmed = status.trim();
  if (LEGACY_STATUS_MAP[trimmed]) return LEGACY_STATUS_MAP[trimmed];
  return trimmed;
}

function casoStatusRank(
  status: string | null | undefined,
  ordemPorChave?: Record<string, number>
): number {
  const normalized = normalizeCasoStatus(status);
  if (ordemPorChave && ordemPorChave[normalized] != null) {
    return ordemPorChave[normalized];
  }
  const idx = CASO_STATUS.findIndex((s) => s.value === normalized);
  return idx >= 0 ? (idx + 1) * 10 : 0;
}

/** Chave de agrupamento por cliente: telefone > CPF > id do caso. */
export function casoClientKey(caso: CasoLookup): string {
  const tel = caso.telefone?.replace(/\D/g, "") ?? "";
  if (tel) return `tel:${tel}`;
  const cpf = caso.cpf?.replace(/\D/g, "") ?? "";
  if (cpf) return `cpf:${cpf}`;
  return `caso:${caso.id}`;
}

/**
 * 1 cliente = 1 card. O n8n pode criar mais de uma linha em casos_novos para
 * o mesmo telefone; aqui fica só a de status mais avançado (empate: a
 * primeira da lista, que já vem ordenada por created_at desc). `idsPorCliente`
 * guarda todos os ids do grupo para mover o cliente inteiro de coluna.
 */
export function dedupeCasosPorCliente<T extends CasoLookup & { status: string | null }>(
  casos: T[],
  ordemPorChave?: Record<string, number>
): { casos: T[]; idsPorCliente: Record<string, number[]> } {
  const cardPorCliente = new Map<string, T>();
  const idsPorCliente: Record<string, number[]> = {};

  for (const caso of casos) {
    const key = casoClientKey(caso);
    (idsPorCliente[key] ??= []).push(caso.id);
    const atual = cardPorCliente.get(key);
    if (
      !atual ||
      casoStatusRank(caso.status, ordemPorChave) >
        casoStatusRank(atual.status, ordemPorChave)
    ) {
      cardPorCliente.set(key, caso);
    }
  }

  return { casos: [...cardPorCliente.values()], idsPorCliente };
}

type AprovacaoLookup = Pick<
  Tables<"aprovacoes_pendentes">,
  "id" | "telefone_cliente" | "cpf" | "status"
>;

type ProcessoLookup = Pick<Tables<"processos_clientes">, "telefone" | "cpf">;

/** Última aprovação por telefone/CPF (lista já ordenada por created_at desc). */
export function buildAprovacaoPorContato(
  aprovacoes: AprovacaoLookup[]
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const a of aprovacoes) {
    const tel = a.telefone_cliente.replace(/\D/g, "");
    if (tel && map[tel] === undefined) map[tel] = a.id;
    const cpf = a.cpf?.replace(/\D/g, "");
    if (cpf && map[cpf] === undefined) map[cpf] = a.id;
  }
  return map;
}

export function buildClientePorTelefone(
  processos: ProcessoLookup[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of processos) {
    const tel = p.telefone?.replace(/\D/g, "");
    const cpf = p.cpf?.replace(/\D/g, "");
    if (tel && cpf && !map[tel]) map[tel] = cpf;
  }
  return map;
}

export function findAprovacaoIdForCaso(
  telefone: string | null | undefined,
  cpf: string | null | undefined,
  aprovacaoPorContato: Record<string, number>
): number | null {
  const tel = telefone?.replace(/\D/g, "") ?? "";
  if (tel && aprovacaoPorContato[tel]) return aprovacaoPorContato[tel];
  const cpfDigits = cpf?.replace(/\D/g, "") ?? "";
  if (cpfDigits && aprovacaoPorContato[cpfDigits]) return aprovacaoPorContato[cpfDigits];
  return null;
}
