/**
 * Filtros das telas /prazos, /audiencias e /pagamentos — puros, usados no
 * navegador (lista na tela) e no servidor (relatório PDF e assistente), para
 * que o PDF traga exatamente o que a tela mostra.
 */
import type { PrazoEnriched } from "@/components/prazos/prazos-ui";
import { diffDaysIso, isIsoDate } from "@/lib/prazos/calendario";
import { PRAZO_TIPOS } from "@/lib/utils/beneficios";

export type PrazoModo = "prazos" | "audiencias" | "pagamentos";

export type PrazoSituacao =
  | "todos"
  | "atrasados"
  | "hoje"
  | "proximos_7"
  | "abertos"
  | "concluidos";

export const PRAZO_SITUACOES: PrazoSituacao[] = [
  "todos",
  "atrasados",
  "hoje",
  "proximos_7",
  "abertos",
  "concluidos",
];

export function isPrazoSituacao(v: unknown): v is PrazoSituacao {
  return typeof v === "string" && (PRAZO_SITUACOES as string[]).includes(v);
}

export function isPrazoModo(v: unknown): v is PrazoModo {
  return v === "prazos" || v === "audiencias" || v === "pagamentos";
}

/** Rótulo da situação conforme a tela ("Pagos" em pagamentos, "Concluídos" no resto). */
export function situacaoLabel(s: PrazoSituacao, modo: PrazoModo): string {
  switch (s) {
    case "todos":
      return "Todas as situações";
    case "atrasados":
      return modo === "audiencias" ? "Passadas sem conclusão" : "Atrasados";
    case "hoje":
      return modo === "prazos" ? "Vencem hoje" : "Hoje";
    case "proximos_7":
      return "Próximos 7 dias";
    case "abertos":
      return modo === "pagamentos" ? "Em aberto (não pagos)" : "Em aberto";
    case "concluidos":
      return modo === "pagamentos" ? "Pagos" : "Concluídos";
  }
}

export function tipoPrazoLabel(tipo: string) {
  return PRAZO_TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
}

/** Dias até o prazo (negativo = atrasado). */
export function diasAte(dataPrazo: string, todayIso: string) {
  return isIsoDate(dataPrazo) ? diffDaysIso(dataPrazo, todayIso) : 0;
}

export function matchesBusca(prazo: PrazoEnriched, q: string) {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  const hay = [
    prazo.titulo,
    prazo.descricao,
    prazo.cpf,
    prazo.cliente_nome,
    prazo.numero_processo,
    prazo.local,
    tipoPrazoLabel(prazo.tipo),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hay.includes(needle)) return true;
  const digits = needle.replace(/\D/g, "");
  if (digits.length < 3) return false;
  return [prazo.cpf, prazo.numero_processo].some((v) =>
    (v ?? "").replace(/\D/g, "").includes(digits)
  );
}

export function matchesSituacao(
  prazo: PrazoEnriched,
  situacao: PrazoSituacao,
  todayIso: string
) {
  if (situacao === "todos") return true;
  if (situacao === "concluidos") return prazo.concluido;
  if (prazo.concluido) return false;
  if (situacao === "abertos") return true;
  const dias = diasAte(prazo.data_prazo, todayIso);
  if (situacao === "atrasados") return dias < 0;
  if (situacao === "hoje") return dias === 0;
  return dias >= 0 && dias <= 7;
}

export type PrazoFiltros = {
  busca?: string;
  /** Tipo do prazo (só na tela de prazos). */
  tipo?: string | null;
  processoId?: number | null;
  parceiroId?: string | null;
  situacao?: PrazoSituacao;
};

/** Mais antigo primeiro; concluídos (histórico) do mais recente para o mais antigo. */
export function ordenarPrazos(prazos: PrazoEnriched[], situacao: PrazoSituacao) {
  const hora = (p: PrazoEnriched) => (p.hora_prazo ?? "99:99").slice(0, 5);
  const dir = situacao === "concluidos" ? -1 : 1;
  return [...prazos].sort(
    (a, b) =>
      dir * a.data_prazo.localeCompare(b.data_prazo) ||
      hora(a).localeCompare(hora(b)) ||
      a.titulo.localeCompare(b.titulo)
  );
}

export function filtrarPrazos(
  prazos: PrazoEnriched[],
  f: PrazoFiltros,
  todayIso: string
): PrazoEnriched[] {
  const situacao = f.situacao ?? "todos";
  return prazos.filter((p) => {
    if (f.tipo && p.tipo !== f.tipo) return false;
    if (f.processoId != null && p.processo_id !== f.processoId) return false;
    if (f.parceiroId && p.parceiro_id !== f.parceiroId) return false;
    if (!matchesSituacao(p, situacao, todayIso)) return false;
    return matchesBusca(p, f.busca ?? "");
  });
}

/** URL do PDF (botão da tela e assistente). Seguro no cliente. */
export function relatorioPrazosHref(params: { modo: PrazoModo } & PrazoFiltros): string {
  const qs = new URLSearchParams();
  qs.set("modo", params.modo);
  if (params.situacao && params.situacao !== "todos") qs.set("situacao", params.situacao);
  if (params.busca?.trim()) qs.set("q", params.busca.trim());
  if (params.tipo) qs.set("tipo", params.tipo);
  if (params.processoId != null) qs.set("processo", String(params.processoId));
  if (params.parceiroId) qs.set("parceiro", params.parceiroId);
  return `/api/prazos/relatorio?${qs.toString()}`;
}
