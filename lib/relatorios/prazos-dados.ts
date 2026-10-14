import "server-only";

import type { PrazoEnriched } from "@/components/prazos/prazos-ui";
import { carregarPrazosPagina } from "@/lib/prazos/carregar-pagina";
import {
  diasAte,
  filtrarPrazos,
  isPrazoModo,
  isPrazoSituacao,
  ordenarPrazos,
  situacaoLabel,
  tipoPrazoLabel,
  type PrazoModo,
  type PrazoSituacao,
} from "@/lib/prazos/filtro";
import { formatNumeroProcesso } from "@/lib/utils/processo";

export class RelatorioPrazosParamError extends Error {}

export type RelatorioPrazosDados = {
  modo: PrazoModo;
  situacao: PrazoSituacao;
  /** Filtros aplicados, já em texto ("Parceiro: Fulano"). */
  filtros: string[];
  itens: PrazoEnriched[];
  todayIso: string;
  resumo: {
    total: number;
    atrasados: number;
    valorTotal: number;
    valorAtrasado: number;
    /** Maior atraso em dias (0 = nenhum atrasado). */
    maiorAtraso: number;
  };
};

export const TITULO_MODO: Record<PrazoModo, string> = {
  prazos: "Prazos",
  audiencias: "Audiências",
  pagamentos: "Pagamentos",
};

export async function carregarRelatorioPrazos(params: {
  modo?: string | null;
  situacao?: string | null;
  busca?: string | null;
  tipo?: string | null;
  processo?: string | number | null;
  parceiro?: string | null;
}): Promise<RelatorioPrazosDados> {
  const modo = params.modo ?? "prazos";
  if (!isPrazoModo(modo)) throw new RelatorioPrazosParamError("Tela inválida (prazos, audiencias ou pagamentos).");
  const situacao = params.situacao || "todos";
  if (!isPrazoSituacao(situacao)) throw new RelatorioPrazosParamError("Situação inválida.");
  const processoId =
    params.processo != null && String(params.processo).trim() !== ""
      ? Number(params.processo)
      : null;
  if (processoId != null && !Number.isInteger(processoId)) {
    throw new RelatorioPrazosParamError("Processo inválido.");
  }
  const tipo = modo === "prazos" ? params.tipo?.trim() || null : null;
  const busca = params.busca?.trim() ?? "";
  const parceiroId = params.parceiro?.trim() || null;

  const { prazos, parceiros, todayIso } = await carregarPrazosPagina({ modo });
  const itens = ordenarPrazos(
    filtrarPrazos(prazos, { busca, tipo, processoId, parceiroId, situacao }, todayIso),
    situacao
  );

  const filtros: string[] = [situacaoLabel(situacao, modo)];
  if (tipo) filtros.push(`Tipo: ${tipoPrazoLabel(tipo)}`);
  if (processoId != null) {
    const p = prazos.find((x) => x.processo_id === processoId);
    const numero = p?.numero_processo ? formatNumeroProcesso(p.numero_processo) : `#${processoId}`;
    filtros.push(`Processo: ${numero}${p?.cliente_nome ? ` (${p.cliente_nome})` : ""}`);
  }
  if (parceiroId) {
    filtros.push(`Parceiro: ${parceiros.find((p) => p.id === parceiroId)?.nome ?? "—"}`);
  }
  if (busca) filtros.push(`Busca: "${busca}"`);

  let atrasados = 0;
  let valorTotal = 0;
  let valorAtrasado = 0;
  let maiorAtraso = 0;
  for (const p of itens) {
    valorTotal += p.valor_centavos ?? 0;
    const dias = diasAte(p.data_prazo, todayIso);
    if (!p.concluido && dias < 0) {
      atrasados++;
      valorAtrasado += p.valor_centavos ?? 0;
      maiorAtraso = Math.max(maiorAtraso, -dias);
    }
  }

  return {
    modo,
    situacao,
    filtros,
    itens,
    todayIso,
    resumo: { total: itens.length, atrasados, valorTotal, valorAtrasado, maiorAtraso },
  };
}
