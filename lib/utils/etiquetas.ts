/** Cores das etiquetas de conversa (mesma ideia do WhatsApp Business). */
export const ETIQUETA_CORES = {
  azul: { label: "Azul", dot: "bg-sky-500", pill: "border-sky-200 bg-sky-50 text-sky-800" },
  verde: { label: "Verde", dot: "bg-emerald-500", pill: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  amarelo: { label: "Amarelo", dot: "bg-amber-400", pill: "border-amber-200 bg-amber-50 text-amber-800" },
  laranja: { label: "Laranja", dot: "bg-orange-500", pill: "border-orange-200 bg-orange-50 text-orange-800" },
  vermelho: { label: "Vermelho", dot: "bg-rose-500", pill: "border-rose-200 bg-rose-50 text-rose-800" },
  roxo: { label: "Roxo", dot: "bg-violet-500", pill: "border-violet-200 bg-violet-50 text-violet-800" },
  rosa: { label: "Rosa", dot: "bg-pink-500", pill: "border-pink-200 bg-pink-50 text-pink-800" },
  cinza: { label: "Cinza", dot: "bg-slate-400", pill: "border-slate-200 bg-slate-50 text-slate-700" },
} as const;

export type EtiquetaCor = keyof typeof ETIQUETA_CORES;

export const ETIQUETA_COR_LISTA = Object.keys(ETIQUETA_CORES) as EtiquetaCor[];

export function corEtiqueta(cor: string | null | undefined) {
  return ETIQUETA_CORES[(cor ?? "") as EtiquetaCor] ?? ETIQUETA_CORES.cinza;
}

export const ETIQUETA_NOME_MAX = 40;
