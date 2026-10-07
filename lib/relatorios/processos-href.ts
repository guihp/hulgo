/** URL da rota que devolve o PDF (botão em /processos e assistente). Seguro no cliente. */
export function relatorioProcessosHref(params: {
  /** "todos" ou omitido = os 4 funis. */
  funil?: string | null;
  /** Chave da coluna (exige funil). */
  coluna?: string | null;
}): string {
  const qs = new URLSearchParams();
  const funil = (params.funil ?? "").trim();
  if (funil && funil !== "todos") qs.set("funil", funil);
  if (params.coluna?.trim()) qs.set("coluna", params.coluna.trim());
  const s = qs.toString();
  return `/api/processos/relatorio${s ? `?${s}` : ""}`;
}
