import "server-only";

import { MENSAGEM_ENCAMINHAMENTO_ANALISE } from "@/lib/casos/encaminhamento-analise";
import { rodarAgente, type ChamadaRegistrada } from "@/lib/ia-whatsapp/agente";
import { ehNumeroDeTeste, getIaConfig, iaAtendeTelefone } from "@/lib/ia-whatsapp/config";
import { atrasoDigitacaoMs, dividirResposta } from "@/lib/ia-whatsapp/dividir";
import { enviarTextoCliente, pausa } from "@/lib/ia-whatsapp/enviar";
import { getIaEstado, iaEstaPausada, pausarIA } from "@/lib/ia-whatsapp/estado";
import { marcarAtendimento } from "@/lib/ia-whatsapp/etiquetas-atendimento";
import { conteudoParaIA } from "@/lib/ia-whatsapp/midia";
import { carregarPersona, montarSystemPrompt } from "@/lib/ia-whatsapp/prompt";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";

const HISTORICO_MAX = 40;
/** Mídias antigas (ex.: áudio mandado durante o atendimento humano) lidas por vez. */
const MIDIAS_HISTORICO_MAX = 8;
const PREFIXO_EQUIPE = "[Mensagem da equipe do escritório, enviada por uma pessoa] ";
/** Mensagens mais antigas que isso não são respondidas (ex.: fila parada por horas). */
const JANELA_PENDENTES_MS = 2 * 60 * 60 * 1000;

type ItemFila = { telefone: string; instancia: string | null; processar_apos: string };

function normalizarComparacao(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9à-ú]/gi, "");
}

async function registrarExecucao(dados: {
  telefone: string;
  status: "ok" | "erro" | "pausada" | "sem_resposta";
  entrada?: string | null;
  respostas?: string[];
  ferramentas?: ChamadaRegistrada[];
  modelo?: string | null;
  promptOrigem?: string | null;
  inicio: number;
  erro?: string | null;
}) {
  const supabase = createServiceClient();
  await supabase.from("app_ia_execucoes").insert({
    telefone: dados.telefone,
    status: dados.status,
    entrada: dados.entrada ?? null,
    respostas: (dados.respostas ?? []) as Json,
    ferramentas: JSON.parse(JSON.stringify(dados.ferramentas ?? [])) as Json,
    modelo: dados.modelo ?? null,
    prompt_origem: dados.promptOrigem ?? null,
    duracao_ms: Date.now() - dados.inicio,
    erro: dados.erro ?? null,
  });
}

async function concluir(item: ItemFila, erro: string | null) {
  const supabase = createServiceClient();
  await supabase.rpc("ia_fila_concluir", {
    p_telefone: item.telefone,
    p_processar_apos: item.processar_apos,
    p_erro: erro,
  });
}

/** Processa as mensagens pendentes de um telefone e responde. */
async function processarTelefone(item: ItemFila): Promise<void> {
  const inicio = Date.now();
  const tel = item.telefone;
  const supabase = createServiceClient();
  let entrada: string | null = null;

  try {
    const config = await getIaConfig();
    if (!iaAtendeTelefone(config, tel)) {
      await concluir(item, null);
      return;
    }

    const estado = await getIaEstado(tel);
    const desdeId = estado?.ultima_mensagem_id ?? 0;
    const { data: pendentes, error } = await supabase
      .from("mensagens")
      .select("*")
      .eq("contact_norm", tel)
      .eq("type", "lead")
      .gt("id", desdeId)
      .gte("created_at", new Date(Date.now() - JANELA_PENDENTES_MS).toISOString())
      .order("id", { ascending: true })
      .limit(30);
    if (error) throw new Error(error.message);
    if (!pendentes?.length) {
      await concluir(item, null);
      return;
    }
    const ultimoId = pendentes[pendentes.length - 1].id;

    if (estado?.pausada) {
      // Atendimento humano: só marca como lidas pela IA.
      await supabase
        .from("app_ia_estado")
        .update({ ultima_mensagem_id: ultimoId, updated_at: new Date().toISOString() })
        .eq("telefone", tel);
      await registrarExecucao({ telefone: tel, status: "pausada", inicio });
      await concluir(item, null);
      return;
    }

    // 1) Como a IA lê cada mensagem (transcrição, descrição, documento)
    for (const m of pendentes) {
      if (m.ia_conteudo != null) continue;
      m.ia_conteudo = await conteudoParaIA(m);
      await supabase.from("mensagens").update({ ia_conteudo: m.ia_conteudo }).eq("id", m.id);
    }
    entrada = pendentes.map((m) => m.ia_conteudo).filter(Boolean).join("\n");

    // 2) Histórico (memória) — desde o último /reset. Inclui o que a equipe
    // conversou com o cliente enquanto a IA estava pausada.
    let histQuery = supabase
      .from("mensagens")
      .select("*")
      .eq("contact_norm", tel)
      .lt("id", pendentes[0].id)
      .order("id", { ascending: false })
      .limit(HISTORICO_MAX);
    if (estado?.memoria_desde) histQuery = histQuery.gte("created_at", estado.memoria_desde);
    const { data: anteriores } = await histQuery;
    const antigas = (anteriores ?? []).reverse();

    // Áudio/foto/documento do cliente que ninguém leu (IA estava pausada): lê agora.
    const semLeitura = antigas
      .filter((m) => m.type === "lead" && m.conteudo_media && m.ia_conteudo == null)
      .slice(-MIDIAS_HISTORICO_MAX);
    for (const m of semLeitura) {
      try {
        m.ia_conteudo = await conteudoParaIA(m);
        await supabase.from("mensagens").update({ ia_conteudo: m.ia_conteudo }).eq("id", m.id);
      } catch {
        // segue com o rótulo genérico
      }
    }

    const historico = antigas
      .map((m) => {
        if (m.type === "lead") {
          return {
            role: "user" as const,
            content: m.ia_conteudo || m.text || `[${m.mensage_type ?? "mensagem"}]`,
          };
        }
        const corpo =
          m.text || (m.mensage_type && m.mensage_type !== "text" ? `[enviado ${m.mensage_type}]` : "");
        // session_id = "ia": a própria IA. O resto saiu do painel ou do celular do escritório.
        const daEquipe = m.session_id !== "ia";
        return {
          role: "assistant" as const,
          content: corpo && daEquipe ? `${PREFIXO_EQUIPE}${corpo}` : corpo,
        };
      })
      .filter((m) => m.content.trim());

    // 3) Prompt
    // Números de teste usam a versão em teste (rascunho) em qualquer modo — inclusive com a
    // IA liberada ao público, para testar mudanças antes de publicar. Os demais clientes
    // seguem na versão publicada.
    const usarRascunho = config.usar_rascunho_no_teste && ehNumeroDeTeste(config, tel);
    const persona = await carregarPersona(usarRascunho);
    const urlsMidia = pendentes.map((m) => m.conteudo_media).filter((u): u is string => Boolean(u));
    const systemPrompt = montarSystemPrompt(persona.texto, {
      telefone: tel,
      nome: estado?.nome_contato ?? "",
      urlsMidia,
    });

    // 4) Agente
    const efeitos = {
      encaminhamentoEnviado: false,
      clienteJaAvisado: false,
      transferidoParaHumano: false,
    };
    const { resposta, chamadas, modelo } = await rodarAgente({
      systemPrompt,
      historico,
      mensagemAtual: entrada,
      contexto: { telefone: tel, instancia: item.instancia, config, efeitos },
    });

    // Avança antes de enviar: um erro no envio não roda as ferramentas de novo.
    await supabase.from("app_ia_estado").upsert(
      { telefone: tel, ultima_mensagem_id: ultimoId, updated_at: new Date().toISOString() },
      { onConflict: "telefone" }
    );

    // 5) Envio — para se o advogado assumir no meio
    let partes = dividirResposta(resposta);
    if (efeitos.encaminhamentoEnviado) {
      const fixa = normalizarComparacao(MENSAGEM_ENCAMINHAMENTO_ANALISE);
      partes = partes.filter((p) => !normalizarComparacao(p).includes(fixa));
    }
    const enviadas: string[] = [];
    for (const parte of partes) {
      if (await iaEstaPausada(tel)) break;
      await pausa(atrasoDigitacaoMs(parte));
      await enviarTextoCliente({ telefone: tel, texto: parte, instancia: item.instancia });
      enviadas.push(parte);
    }

    if (efeitos.transferidoParaHumano) {
      // Pediu atendimento humano: a resposta deste turno já saiu; daqui pra frente, a equipe.
      await pausarIA(tel, "transferencia");
    } else if (enviadas.length || efeitos.clienteJaAvisado) {
      if (!(await iaEstaPausada(tel))) await marcarAtendimento(tel, "ia");
    }

    await registrarExecucao({
      telefone: tel,
      status: enviadas.length ? "ok" : (await iaEstaPausada(tel)) ? "pausada" : "sem_resposta",
      entrada,
      respostas: enviadas,
      ferramentas: chamadas,
      modelo,
      promptOrigem: persona.origem,
      inicio,
    });
    await concluir(item, null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ia-whatsapp] ${tel}:`, msg);
    await registrarExecucao({ telefone: tel, status: "erro", entrada, inicio, erro: msg }).catch(() => {});
    await concluir(item, msg).catch(() => {});
  }
}

async function rodarFila(): Promise<{ processados: number }> {
  let processados = 0;
  const supabase = createServiceClient();
  for (let rodada = 0; rodada < 20; rodada++) {
    const { data, error } = await supabase.rpc("ia_fila_pegar", { p_limite: 3 });
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    await Promise.all(data.map((item) => processarTelefone(item)));
    processados += data.length;
  }
  return { processados };
}

// Execuções neste processo ficam em série; entre processos, o SKIP LOCKED do banco separa.
let cadeia: Promise<unknown> = Promise.resolve();

/**
 * Processa a fila até esvaziar o que está vencido. Chamado pelo webhook
 * (after, depois do debounce), pelo cron de 1 min e pelo botão da página.
 */
export function processarFilaIA(): Promise<{ processados: number }> {
  const execucao = cadeia.then(rodarFila, rodarFila);
  cadeia = execucao.catch(() => {});
  return execucao;
}
