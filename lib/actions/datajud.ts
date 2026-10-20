"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getAppUser } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { consultarDataJud, type ResultadoDataJud } from "@/lib/datajud";
import {
  executarRodadaDataJud,
  getDataJudConfig,
  registrarConsultaDataJud,
  type RodadaDataJud,
} from "@/lib/datajud-monitor";
import { isValidNumeroProcesso } from "@/lib/utils/processo";

/**
 * Consulta na hora (ficha do cliente). Com processoId, também grava a última
 * movimentação no processo — o card passa a mostrar o andamento da Justiça.
 */
export async function consultarProcessoDataJud(
  numeroProcesso: string,
  processoId?: number
): Promise<ResultadoDataJud> {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  const resultado = await consultarDataJud(numeroProcesso);

  if (processoId) {
    // Lê com a sessão do usuário (RLS) para só gravar em processo que ele enxerga.
    const supabase = await createClient();
    const { data: processo } = await supabase
      .from("processos_clientes")
      .select("id, nome, cpf, telefone, numero_processo, datajud_mov_chave, datajud_mov_data")
      .eq("id", processoId)
      .maybeSingle();
    if (processo?.numero_processo) {
      await registrarConsultaDataJud(
        createServiceClient(),
        { ...processo, numero_processo: processo.numero_processo },
        resultado
      );
      revalidatePath("/processos");
    }
  }
  return resultado;
}

/** Intervalo da consulta automática do processo: null = padrão (todo dia), 0 = não consultar. */
export async function definirMonitoramento(
  processoId: number,
  dias: number | null
) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (dias !== null && ![0, 3, 7, 15, 30].includes(dias)) {
    throw new Error("Frequência inválida");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("processos_clientes")
    .update({ monitorar_dias: dias })
    .eq("id", processoId);
  if (error) throw new Error(error.message);

  revalidatePath("/clientes");
  return { success: true };
}

export type DataJudPainel = {
  auto: boolean;
  pendencias: boolean;
  ultimaRodada: RodadaDataJud | null;
  /** Processos ativos com nº CNJ (os que entram na consulta). */
  comNumeroCnj: number;
  consultadosUltimas24h: number;
  nuncaConsultados: number;
  novidades7dias: number;
  naoEncontrados: number;
};

export async function getDataJudPainel(): Promise<DataJudPainel> {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const service = createServiceClient();
  const [config, { data, error }] = await Promise.all([
    getDataJudConfig(service),
    service
      .from("processos_clientes")
      .select("numero_processo, monitorar_dias, ultima_consulta_datajud, datajud_novidade_em, datajud_resultado")
      .eq("ativo", true)
      .not("numero_processo", "is", null),
  ]);
  if (error) throw new Error(error.message);

  const agora = Date.now();
  const cnj = (data ?? []).filter(
    (p) => p.numero_processo && isValidNumeroProcesso(p.numero_processo) && p.monitorar_dias !== 0
  );
  const dentro = (iso: string | null, ms: number) =>
    Boolean(iso) && agora - new Date(iso!).getTime() < ms;

  return {
    auto: config.auto,
    pendencias: config.pendencias,
    ultimaRodada: config.ultimaRodada,
    comNumeroCnj: cnj.length,
    consultadosUltimas24h: cnj.filter((p) => dentro(p.ultima_consulta_datajud, 24 * 3600_000)).length,
    nuncaConsultados: cnj.filter((p) => !p.ultima_consulta_datajud).length,
    novidades7dias: cnj.filter((p) => dentro(p.datajud_novidade_em, 7 * 24 * 3600_000)).length,
    naoEncontrados: cnj.filter((p) => p.ultima_consulta_datajud && p.datajud_resultado).length,
  };
}

async function requireAdvogado() {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (user.papel !== "advogado") throw new Error("Apenas advogados podem alterar esta configuração");
  return user;
}

export async function salvarDataJudConfig(input: { auto: boolean; pendencias: boolean }) {
  await requireAdvogado();
  const supabase = await createClient();
  const agora = new Date().toISOString();
  for (const [chave, valor] of [
    ["datajud_auto", input.auto ? "1" : "0"],
    ["datajud_pendencias", input.pendencias ? "1" : "0"],
  ] as const) {
    const { error } = await supabase
      .from("app_config")
      .update({ valor, updated_at: agora })
      .eq("chave", chave);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/configuracoes");
}

/** Dispara uma rodada em segundo plano (a resposta volta na hora). */
export async function consultarTodosDataJudAgora() {
  await requireAdvogado();
  after(async () => {
    try {
      await executarRodadaDataJud({ orcamentoMs: 270_000, forcar: true });
    } catch (e) {
      console.error("[datajud] consulta manual", e);
    }
  });
  return { iniciado: true };
}
