import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import {
  consultarDataJud,
  consultarDataJudLote,
  resolverAliasDataJud,
  type MovimentoDataJud,
  type ResultadoDataJud,
} from "@/lib/datajud";
import { phoneToContactNorm } from "@/lib/utils/phone";
import { isValidNumeroProcesso } from "@/lib/utils/processo";
import type { Database } from "@/types/database";

type Service = ReturnType<typeof createServiceClient>;

/** Espera entre consultas para não levar 429 da API pública do CNJ. */
const PAUSA_ENTRE_CONSULTAS_MS = 2500;
/** Processos por requisição ao CNJ (consulta em lote por tribunal). */
const TAMANHO_LOTE = 20;
/** Margem para considerar "já consultado hoje" (o cron pode rodar alguns minutos antes). */
const FOLGA_INTERVALO_MS = 4 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

export type DataJudConfig = {
  /** Consulta automática diária ligada. */
  auto: boolean;
  /** Movimentação nova vira pendência em Aprovações. */
  pendencias: boolean;
  ultimaRodada: RodadaDataJud | null;
};

export type RodadaDataJud = {
  em: string;
  consultados: number;
  novidades: number;
  naoEncontrados: number;
  falhas: number;
  pendenciasCriadas: number;
  /** Processos que ficaram para a próxima execução (tempo esgotado ou limite do CNJ). */
  restantes: number;
};

export async function getDataJudConfig(service: Service = createServiceClient()): Promise<DataJudConfig> {
  const { data } = await service
    .from("app_config")
    .select("chave, valor")
    .in("chave", ["datajud_auto", "datajud_pendencias", "datajud_ultima_rodada"]);
  const map = new Map((data ?? []).map((r) => [r.chave, r.valor ?? ""]));
  let ultimaRodada: RodadaDataJud | null = null;
  try {
    const raw = map.get("datajud_ultima_rodada");
    if (raw) ultimaRodada = JSON.parse(raw) as RodadaDataJud;
  } catch {
    ultimaRodada = null;
  }
  return {
    // Sem a linha (migration não aplicada) vale o padrão: ligado, sem pendências.
    auto: map.get("datajud_auto") !== "0",
    pendencias: map.get("datajud_pendencias") === "1",
    ultimaRodada,
  };
}

/** "Juntada de Petição — Contestação" */
export function textoMovimento(m: MovimentoDataJud): string {
  return m.complemento ? `${m.nome} — ${m.complemento}` : m.nome;
}

function chaveMovimento(m: MovimentoDataJud): string {
  return `${m.data}|${m.nome}`;
}

function dataValida(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type ProcessoMonitorado = {
  id: number;
  nome: string | null;
  cpf: string | null;
  telefone: string | null;
  numero_processo: string;
  datajud_mov_chave: string | null;
  datajud_mov_data: string | null;
};

/**
 * Grava o resultado de uma consulta no processo. Devolve se houve movimentação
 * nova (só conta quando já havia uma movimentação anterior gravada — a primeira
 * consulta apenas registra o ponto de partida).
 */
export async function registrarConsultaDataJud(
  service: Service,
  processo: ProcessoMonitorado,
  consulta: ResultadoDataJud
): Promise<{ novidade: boolean; topo: MovimentoDataJud | null }> {
  const agora = new Date().toISOString();

  if (!consulta.encontrado) {
    // Falha passageira: não marca como consultado para tentar de novo na próxima execução.
    if (consulta.temporario) return { novidade: false, topo: null };
    await service
      .from("processos_clientes")
      .update({ ultima_consulta_datajud: agora, datajud_resultado: consulta.motivo })
      .eq("id", processo.id);
    return { novidade: false, topo: null };
  }

  const topo = consulta.movimentos[0] ?? null;
  const update: Database["public"]["Tables"]["processos_clientes"]["Update"] = {
    ultima_consulta_datajud: agora,
    datajud_resultado: null,
  };
  let novidade = false;

  if (topo) {
    const chave = chaveMovimento(topo);
    const dataTopo = dataValida(topo.data);
    const anterior = processo.datajud_mov_data ? new Date(processo.datajud_mov_data).getTime() : 0;
    // Um grau diferente às vezes devolve movimentos mais antigos: só avança.
    const maisRecente = !dataTopo || new Date(dataTopo).getTime() >= anterior;
    if (chave !== processo.datajud_mov_chave && maisRecente) {
      update.datajud_mov_chave = chave;
      update.datajud_mov_data = dataTopo;
      update.datajud_mov_texto = textoMovimento(topo);
      if (processo.datajud_mov_chave) {
        novidade = true;
        update.datajud_novidade_em = agora;
      }
    }
  }

  await service.from("processos_clientes").update(update).eq("id", processo.id);
  return { novidade, topo };
}

/**
 * Consulta na hora pedida pelo assistente ou pela IA do WhatsApp: até `tentativas`
 * tentativas (40 s cada, 3 s entre elas) e grava o resultado no processo, para o
 * sistema "ficar sabendo" da movimentação.
 */
export async function consultarAoVivoERegistrar(
  numero: string,
  processos: ProcessoMonitorado[],
  tentativasMax = 3
): Promise<{ consulta: ResultadoDataJud; tentativas: number; novidade: boolean }> {
  let consulta: ResultadoDataJud = { encontrado: false, motivo: "Não consultado", temporario: true };
  let tentativas = 0;
  for (let i = 0; i < tentativasMax; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 3000));
    tentativas++;
    consulta = await consultarDataJud(numero, { tentativas: 1, timeoutMs: 40_000 });
    if (consulta.encontrado || !consulta.temporario) break;
  }
  let novidade = false;
  const service = createServiceClient();
  for (const p of processos) {
    const r = await registrarConsultaDataJud(service, p, consulta);
    novidade ||= r.novidade;
  }
  return { consulta, tentativas, novidade };
}

function resumoPendencia(numero: string, consulta: Extract<ResultadoDataJud, { encontrado: true }>) {
  const ultimas = consulta.movimentos
    .slice(0, 5)
    .map((m) => {
      const d = m.data ? new Date(m.data) : null;
      const dataFmt =
        d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
      return `• ${dataFmt} — ${textoMovimento(m)}`;
    })
    .join("\n");
  return (
    `🔎 Atualização automática do processo ${numero} (${consulta.tribunal}).\n\n` +
    `Últimas movimentações:\n${ultimas}\n\n` +
    `Revise e edite este texto antes de aprovar o envio ao cliente.`
  );
}

/**
 * Uma execução do robô: consulta os processos ativos com nº CNJ cuja última
 * consulta venceu (padrão: 1 dia; monitorar_dias muda o intervalo; 0 = nunca),
 * os mais antigos primeiro, até o tempo acabar. O que sobrar fica para a
 * próxima execução — por isso o cron roda de hora em hora.
 */
export async function executarRodadaDataJud(opts: {
  orcamentoMs: number;
  /** Ignora a chave "datajud_auto" (botão "Consultar agora"). */
  forcar?: boolean;
}): Promise<{ desligado: true } | ({ desligado: false; relatorio: { processo: string; resultado: string }[] } & RodadaDataJud)> {
  const inicio = Date.now();
  const service = createServiceClient();
  const config = await getDataJudConfig(service);
  if (!config.auto && !opts.forcar) return { desligado: true };

  const { data: processos, error } = await service
    .from("processos_clientes")
    .select(
      "id, nome, cpf, telefone, numero_processo, monitorar_dias, ultima_consulta_datajud, datajud_mov_chave, datajud_mov_data"
    )
    .eq("ativo", true)
    .not("numero_processo", "is", null)
    .order("ultima_consulta_datajud", { ascending: true, nullsFirst: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);

  const vencidos = (processos ?? []).filter((p) => {
    if (!p.numero_processo || !isValidNumeroProcesso(p.numero_processo)) return false;
    if (p.monitorar_dias === 0) return false;
    if (!p.ultima_consulta_datajud) return true;
    const intervalo = (p.monitorar_dias ?? 1) * DIA_MS - FOLGA_INTERVALO_MS;
    return inicio - new Date(p.ultima_consulta_datajud).getTime() >= intervalo;
  });

  let instancia: string | null = null;
  if (config.pendencias) {
    const { data } = await service
      .from("app_config")
      .select("valor")
      .eq("chave", "whatsapp_instancia")
      .maybeSingle();
    instancia = data?.valor?.trim() || process.env.EVOGO_INSTANCE_NAME || null;
  }

  const relatorio: { processo: string; resultado: string }[] = [];
  const rodada: RodadaDataJud = {
    em: new Date().toISOString(),
    consultados: 0,
    novidades: 0,
    naoEncontrados: 0,
    falhas: 0,
    pendenciasCriadas: 0,
    restantes: 0,
  };

  type Vencido = (typeof vencidos)[number] & { numero_processo: string };

  async function tratar(p: Vencido, consulta: ResultadoDataJud) {
    const { novidade } = await registrarConsultaDataJud(service, p, consulta);
    if (!consulta.encontrado) {
      if (consulta.temporario) {
        rodada.falhas++;
        relatorio.push({ processo: p.numero_processo, resultado: `falha passageira: ${consulta.motivo}` });
      } else {
        rodada.consultados++;
        rodada.naoEncontrados++;
        relatorio.push({ processo: p.numero_processo, resultado: consulta.motivo });
      }
      return;
    }

    rodada.consultados++;
    if (!novidade) {
      relatorio.push({ processo: p.numero_processo, resultado: "sem movimentação nova" });
      return;
    }
    rodada.novidades++;

    if (!config.pendencias) {
      relatorio.push({ processo: p.numero_processo, resultado: "movimentação nova (atualizada no card)" });
      return;
    }
    const telefone = phoneToContactNorm(p.telefone);
    if (!telefone) {
      relatorio.push({
        processo: p.numero_processo,
        resultado: "movimentação nova, mas processo sem telefone — pendência não criada",
      });
      return;
    }
    const { error: insErr } = await service.from("aprovacoes_pendentes").insert({
      telefone_cliente: telefone,
      nome_cliente: p.nome,
      cpf: p.cpf,
      numero_processo: p.numero_processo,
      resumo: resumoPendencia(p.numero_processo, consulta),
      instancia,
      status: "pendente",
    });
    if (insErr) {
      relatorio.push({ processo: p.numero_processo, resultado: `erro ao criar pendência: ${insErr.message}` });
      return;
    }
    rodada.pendenciasCriadas++;
    relatorio.push({ processo: p.numero_processo, resultado: "movimentação nova → pendência em Aprovações" });
  }

  // Lotes por tribunal: uma requisição ao CNJ traz até TAMANHO_LOTE processos.
  const porTribunal = new Map<string, Vencido[]>();
  for (const row of vencidos) {
    const p = { ...row, numero_processo: row.numero_processo! };
    const alias = resolverAliasDataJud(p.numero_processo);
    if (!alias) {
      await tratar(p, await consultarDataJud(p.numero_processo)); // "Tribunal não suportado", sem chamar o CNJ
      continue;
    }
    porTribunal.set(alias, [...(porTribunal.get(alias) ?? []), p]);
  }
  const lotes: Vencido[][] = [];
  for (const lista of porTribunal.values()) {
    for (let k = 0; k < lista.length; k += TAMANHO_LOTE) lotes.push(lista.slice(k, k + TAMANHO_LOTE));
  }

  let falhasSeguidas = 0;
  for (let l = 0; l < lotes.length; l++) {
    // Com o CNJ lento, um lote (2 tentativas de 60 s + espera) passa de 2 minutos.
    if (Date.now() - inicio > opts.orcamentoMs - 130_000) {
      rodada.restantes = lotes.slice(l).reduce((t, lote) => t + lote.length, 0);
      break;
    }
    if (l > 0) await new Promise((r) => setTimeout(r, PAUSA_ENTRE_CONSULTAS_MS));

    const lote = lotes[l];
    const resultados = await consultarDataJudLote(lote.map((p) => p.numero_processo));
    let falhaDoLote: string | null = null;
    for (const p of lote) {
      const consulta = resultados.get(p.numero_processo.replace(/\D/g, ""))!;
      if (!consulta.encontrado && consulta.temporario) falhaDoLote = consulta.motivo;
      await tratar(p, consulta);
    }

    if (!falhaDoLote) {
      falhasSeguidas = 0;
      continue;
    }
    // Limite do CNJ ou CNJ fora do ar: para agora e continua na próxima execução.
    falhasSeguidas++;
    if (falhaDoLote.includes("Limite de consultas") || falhasSeguidas >= 2) {
      rodada.restantes = lotes.slice(l + 1).reduce((t, lote2) => t + lote2.length, 0);
      break;
    }
  }

  // Só registra rodadas que fizeram algo (as execuções de hora em hora sem nada vencido não apagam o resumo).
  if (rodada.consultados || rodada.falhas) {
    await service
      .from("app_config")
      .update({ valor: JSON.stringify(rodada), updated_at: new Date().toISOString() })
      .eq("chave", "datajud_ultima_rodada");
  }

  return { desligado: false, ...rodada, relatorio };
}
