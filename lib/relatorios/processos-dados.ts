import { createClient } from "@/lib/supabase/server";
import { listParceiros, type Parceiro } from "@/lib/actions/parceiros";
import {
  listProcessoColunas,
  type ProcessoColunaMatch,
} from "@/lib/data/processo-colunas";
import {
  FUNIL_PROCESSO_PADRAO,
  FUNIS_PROCESSO,
  isFunilProcesso,
  labelFunilProcesso,
  type FunilProcesso,
} from "@/lib/utils/processos";
import type { Tables } from "@/types/database";

type Processo = Tables<"processos_clientes">;

export type RelatorioProcessoItem = Pick<
  Processo,
  | "id"
  | "nome"
  | "cpf"
  | "telefone"
  | "numero_processo"
  | "beneficio_identificado"
  | "tipo_acao"
  | "polo_passivo"
  | "vara_comarca"
  | "tribunal"
  | "situacao"
  | "ultimo_andamento_data"
  | "ultimo_movimento"
  | "observacao"
  | "valor_centavos"
> & { parceiro_nome: string | null };

export type RelatorioColuna = {
  chave: string;
  label: string;
  cor: string | null;
  processos: RelatorioProcessoItem[];
};

export type RelatorioFunil = {
  funil: FunilProcesso;
  label: string;
  colunas: RelatorioColuna[];
};

export type RelatorioProcessosDados = {
  funis: RelatorioFunil[];
  /** Escopo pedido (para título e nome do arquivo). */
  escopo: { funil: FunilProcesso | "todos"; coluna: string | null };
  total: number;
};

export type RelatorioProcessosParams = {
  /** "todos" ou omitido = os 4 funis. */
  funil?: string | null;
  /** Chave da coluna (só com funil específico). Omitido = todas as colunas. */
  coluna?: string | null;
};

export class RelatorioParamError extends Error {}

/**
 * Carrega os processos agrupados por funil → coluna, com a mesma regra do quadro
 * (/processos): card com funil_coluna inativa/nula cai na primeira coluna ativa.
 * Usa a sessão do usuário (RLS).
 */
export async function carregarRelatorioProcessos(
  params: RelatorioProcessosParams
): Promise<RelatorioProcessosDados> {
  const funilRaw = (params.funil ?? "").trim();
  const colunaRaw = (params.coluna ?? "").trim() || null;

  let funis: FunilProcesso[];
  if (!funilRaw || funilRaw === "todos") {
    if (colunaRaw) {
      throw new RelatorioParamError("Para filtrar por coluna, informe também o funil.");
    }
    funis = FUNIS_PROCESSO.map((f) => f.value);
  } else if (isFunilProcesso(funilRaw)) {
    funis = [funilRaw];
  } else {
    throw new RelatorioParamError(`Funil inválido: ${funilRaw}`);
  }

  const supabase = await createClient();
  const [{ data: processos, error }, colunasPorFunil, parceiros] = await Promise.all([
    supabase
      .from("processos_clientes")
      .select(
        "id, nome, cpf, telefone, area, funil_coluna, numero_processo, beneficio_identificado, tipo_acao, polo_passivo, vara_comarca, tribunal, situacao, ultimo_andamento_data, ultimo_movimento, observacao, valor_centavos, parceiro_id"
      )
      .order("nome", { ascending: true }),
    Promise.all(funis.map((f) => listProcessoColunas(f))),
    listParceiros().catch(() => [] as Parceiro[]),
  ]);
  if (error) throw new Error(error.message);

  const parceiroNome = new Map(parceiros.map((p) => [p.id, p.nome]));

  const resultado: RelatorioFunil[] = funis.map((funil, i) => {
    const colunas: ProcessoColunaMatch[] = colunasPorFunil[i];
    if (colunaRaw && !colunas.some((c) => c.chave === colunaRaw)) {
      throw new RelatorioParamError(
        `Coluna "${colunaRaw}" não existe no funil ${labelFunilProcesso(funil)}. Colunas: ${colunas.map((c) => c.chave).join(", ")}`
      );
    }
    const ativas = new Set(colunas.map((c) => c.chave));
    const primeira = colunas[0]?.chave ?? "";
    const grupos = new Map<string, RelatorioProcessoItem[]>(
      colunas.map((c) => [c.chave, []])
    );

    for (const p of processos ?? []) {
      // Mesma regra da página: funil padrão inclui area nula.
      const doFunil =
        p.area === funil || (funil === FUNIL_PROCESSO_PADRAO && !p.area);
      if (!doFunil) continue;
      const chave =
        p.funil_coluna && ativas.has(p.funil_coluna) ? p.funil_coluna : primeira;
      grupos.get(chave)?.push({
        id: p.id,
        nome: p.nome,
        cpf: p.cpf,
        telefone: p.telefone,
        numero_processo: p.numero_processo,
        beneficio_identificado: p.beneficio_identificado,
        tipo_acao: p.tipo_acao,
        polo_passivo: p.polo_passivo,
        vara_comarca: p.vara_comarca,
        tribunal: p.tribunal,
        situacao: p.situacao,
        ultimo_andamento_data: p.ultimo_andamento_data,
        ultimo_movimento: p.ultimo_movimento,
        observacao: p.observacao,
        valor_centavos: p.valor_centavos,
        parceiro_nome: p.parceiro_id ? parceiroNome.get(p.parceiro_id) ?? null : null,
      });
    }

    return {
      funil,
      label: labelFunilProcesso(funil),
      colunas: colunas
        .filter((c) => !colunaRaw || c.chave === colunaRaw)
        .map((c) => ({
          chave: c.chave,
          label: c.label,
          cor: c.cor,
          processos: grupos.get(c.chave) ?? [],
        })),
    };
  });

  return {
    funis: resultado,
    escopo: {
      funil: funis.length === 1 ? funis[0] : "todos",
      coluna: colunaRaw,
    },
    total: resultado.reduce(
      (s, f) => s + f.colunas.reduce((t, c) => t + c.processos.length, 0),
      0
    ),
  };
}
