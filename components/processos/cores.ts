import type { CorColunaProcesso } from "@/lib/utils/processos";

/** Classes estáticas (Tailwind não gera classes montadas dinamicamente). */
export const COR_COLUNA_DOT: Record<CorColunaProcesso, string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  emerald: "bg-emerald-500",
  cyan: "bg-cyan-500",
  orange: "bg-orange-500",
};

export const COR_COLUNA_BORDER: Record<CorColunaProcesso, string> = {
  slate: "border-t-slate-400",
  blue: "border-t-blue-500",
  violet: "border-t-violet-500",
  amber: "border-t-amber-500",
  rose: "border-t-rose-500",
  emerald: "border-t-emerald-500",
  cyan: "border-t-cyan-500",
  orange: "border-t-orange-500",
};

export const COR_COLUNA_LABEL: Record<CorColunaProcesso, string> = {
  slate: "Cinza",
  blue: "Azul",
  violet: "Roxo",
  amber: "Âmbar",
  rose: "Rosa",
  emerald: "Verde",
  cyan: "Ciano",
  orange: "Laranja",
};

export function corDot(cor: string | null | undefined): string {
  return (cor && COR_COLUNA_DOT[cor as CorColunaProcesso]) || "bg-slate-300";
}

export function corBorder(cor: string | null | undefined): string {
  return (
    (cor && COR_COLUNA_BORDER[cor as CorColunaProcesso]) || "border-t-transparent"
  );
}
