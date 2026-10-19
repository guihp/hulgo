import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/types/database";
import {
  FUNIS_PROCESSO,
  isFunilProcesso,
  type FunilProcesso,
} from "@/lib/utils/processos";

export type ProcessoColuna = Tables<"app_processo_colunas">;

export type ProcessoColunaMatch = {
  id: string | null;
  funil: FunilProcesso;
  chave: string;
  label: string;
  ordem: number;
  ativo: boolean;
  cor: string | null;
};

const FALLBACK: Record<FunilProcesso, [string, string, string][]> = {
  previdenciario: [
    ["a_ajuizar", "Petição inicial / A ajuizar", "slate"],
    ["ajuizado", "Ajuizado", "blue"],
    ["pericia_audiencia", "Perícia / Audiência", "violet"],
    ["sentenca", "Sentença", "amber"],
    ["recurso", "Recurso", "rose"],
    ["cumprimento_rpv", "Cumprimento / RPV", "emerald"],
    ["arquivado", "Arquivado", "slate"],
  ],
  civel: [
    ["novo_andamento", "Novo / Em andamento", "blue"],
    ["providencia_escritorio", "Providência do escritório", "rose"],
    ["cumprimento_sentenca", "Cumprimento de sentença", "amber"],
    ["precatorio_aguardando", "Precatório aguardando pagamento", "violet"],
    ["pago_arquivado", "Pago / Arquivado", "slate"],
  ],
  administrativo: [
    ["requerimento_protocolar", "Requerimento a protocolar", "slate"],
    ["protocolado_analise", "Protocolado / Em análise INSS", "blue"],
    ["exigencia", "Exigência", "amber"],
    ["pericia_avaliacao", "Perícia / Avaliação social", "violet"],
    ["indeferido", "Indeferido (avaliar recurso/judicial)", "rose"],
    ["recurso_administrativo", "Recurso administrativo", "orange"],
  ],
  concedido: [
    ["aguardando_implantacao", "Concedido — aguardando implantação", "cyan"],
    ["implantado", "Implantado", "emerald"],
    ["aguardando_rpv_precatorio", "Aguardando RPV/Precatório", "amber"],
    ["pago_honorarios", "Pago / Honorários recebidos", "violet"],
    ["arquivado", "Arquivado", "slate"],
  ],
};

function fallbackColunas(funil: FunilProcesso): ProcessoColunaMatch[] {
  return FALLBACK[funil].map(([chave, label, cor], i) => ({
    id: null,
    funil,
    chave,
    label,
    ordem: (i + 1) * 10,
    ativo: true,
    cor,
  }));
}

export function processoColunaRowToMatch(
  row: ProcessoColuna
): ProcessoColunaMatch {
  return {
    id: row.id,
    funil: isFunilProcesso(row.funil) ? row.funil : "previdenciario",
    chave: row.chave,
    label: row.label,
    ordem: row.ordem,
    ativo: row.ativo,
    cor: row.cor,
  };
}

/** Lista colunas de um funil (ativas por padrão). Fallback = seed em memória. */
export async function listProcessoColunas(
  funil: FunilProcesso,
  opts?: {
    includeInactive?: boolean;
    service?: boolean;
    allowFallback?: boolean;
  }
): Promise<ProcessoColunaMatch[]> {
  const supabase = opts?.service
    ? createServiceClient()
    : await createClient();

  let query = supabase
    .from("app_processo_colunas")
    .select("*")
    .eq("funil", funil)
    .order("ordem", { ascending: true })
    .order("label", { ascending: true });

  if (!opts?.includeInactive) {
    query = query.eq("ativo", true);
  }

  const { data, error } = await query;
  if (error) {
    if (opts?.allowFallback === false) throw new Error(error.message);
    return fallbackColunas(funil);
  }

  if (!data || data.length === 0) {
    if (opts?.allowFallback === false) return [];
    return fallbackColunas(funil);
  }

  return data.map(processoColunaRowToMatch);
}

/** Colunas de todos os funis de uma vez (formulários que trocam de área). */
export async function listProcessoColunasTodas(opts?: {
  includeInactive?: boolean;
}): Promise<Record<FunilProcesso, ProcessoColunaMatch[]>> {
  const lists = await Promise.all(
    FUNIS_PROCESSO.map((f) => listProcessoColunas(f.value, opts))
  );
  return Object.fromEntries(
    FUNIS_PROCESSO.map((f, i) => [f.value, lists[i]])
  ) as Record<FunilProcesso, ProcessoColunaMatch[]>;
}

export function labelDaColunaProcesso(
  chave: string | null | undefined,
  colunas: ProcessoColunaMatch[]
): string {
  if (!chave) return "—";
  return colunas.find((c) => c.chave === chave)?.label ?? chave;
}
