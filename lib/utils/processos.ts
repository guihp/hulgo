export type FunilProcesso = "previdenciario" | "civel";

export const FUNIS_PROCESSO: { value: FunilProcesso; label: string }[] = [
  { value: "previdenciario", label: "Previdenciário" },
  { value: "civel", label: "Cível" },
];

export function isFunilProcesso(v: unknown): v is FunilProcesso {
  return v === "previdenciario" || v === "civel";
}

/** Mesma regra do trigger `processos_clientes_normaliza_funil` no banco. */
export function normalizeAreaProcesso(
  area: string | null | undefined
): FunilProcesso {
  const a = (area ?? "").toLowerCase();
  return a.includes("civ") || a.includes("cív") ? "civel" : "previdenciario";
}

export function labelFunilProcesso(funil: string | null | undefined): string {
  return (
    FUNIS_PROCESSO.find((f) => f.value === funil)?.label ?? "Previdenciário"
  );
}

export type SituacaoProcesso =
  | "providencia_escritorio"
  | "cumprimento_pagamento"
  | "verificar_1grau"
  | "aguardando";

export const SITUACOES_PROCESSO: {
  value: SituacaoProcesso;
  label: string;
  /** Classes Tailwind para badge/etiqueta */
  className: string;
  /** Classe do ponto/indicador sólido */
  dotClassName: string;
}[] = [
  {
    value: "providencia_escritorio",
    label: "Providência do escritório",
    className:
      "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900",
    dotClassName: "bg-rose-500",
  },
  {
    value: "cumprimento_pagamento",
    label: "Cumprimento / Pagamento",
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900",
    dotClassName: "bg-amber-500",
  },
  {
    value: "verificar_1grau",
    label: "Verificar no 1º grau",
    className:
      "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900",
    dotClassName: "bg-blue-500",
  },
  {
    value: "aguardando",
    label: "Aguardando",
    className:
      "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-800",
    dotClassName: "bg-slate-400",
  },
];

export function isSituacaoProcesso(v: unknown): v is SituacaoProcesso {
  return SITUACOES_PROCESSO.some((s) => s.value === v);
}

export function situacaoProcessoInfo(situacao: string | null | undefined) {
  return SITUACOES_PROCESSO.find((s) => s.value === situacao) ?? null;
}

export type ModalidadeAudiencia = "presencial" | "virtual";

export const MODALIDADES_AUDIENCIA: {
  value: ModalidadeAudiencia;
  label: string;
}[] = [
  { value: "presencial", label: "Presencial" },
  { value: "virtual", label: "Virtual" },
];

export function isModalidadeAudiencia(v: unknown): v is ModalidadeAudiencia {
  return v === "presencial" || v === "virtual";
}

/** Cores permitidas em `app_processo_colunas.cor` (nomes Tailwind). */
export const CORES_COLUNA_PROCESSO = [
  "slate",
  "blue",
  "violet",
  "amber",
  "rose",
  "emerald",
  "cyan",
  "orange",
] as const;

export type CorColunaProcesso = (typeof CORES_COLUNA_PROCESSO)[number];

export function isCorColunaProcesso(v: unknown): v is CorColunaProcesso {
  return (CORES_COLUNA_PROCESSO as readonly unknown[]).includes(v);
}

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** 123456 → "R$ 1.234,56"; null → "—" */
export function formatValorCentavos(
  centavos: number | null | undefined
): string {
  if (centavos === null || centavos === undefined || !Number.isFinite(centavos)) {
    return "—";
  }
  return BRL.format(centavos / 100);
}

/**
 * Converte texto em reais para centavos. Aceita "R$ 1.234,56", "1234,56",
 * "1234.56", "1.234". Vazio/inválido → null.
 */
export function parseValorReais(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) : null;
  }
  let s = raw.replace(/[^\d.,-]/g, "").trim();
  if (!s || s.startsWith("-")) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // O último separador é o decimal
    s =
      lastComma > lastDot
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    // "1.234" (milhar) vs "1234.5" (decimal): 3 dígitos após o único ponto = milhar
    const parts = s.split(".");
    const isMilhar =
      parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    if (isMilhar) s = s.replace(/\./g, "");
  }

  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
