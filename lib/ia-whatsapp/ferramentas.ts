import "server-only";

import {
  enviarEncaminhamentoAnaliseSePendente,
  MENSAGEM_ENCAMINHAMENTO_ANALISE,
} from "@/lib/casos/encaminhamento-analise";
import { CASO_STATUS } from "@/lib/constants";
import { listKanbanColunas } from "@/lib/data/kanban-colunas";
import { listTiposCaso, matchTipoCaso } from "@/lib/data/tipos-caso";
import { consultarDataJud } from "@/lib/datajud";
import { urlPainel, type IaWhatsappConfig } from "@/lib/ia-whatsapp/config";
import { enviarParaAdvogado, enviarTextoCliente } from "@/lib/ia-whatsapp/enviar";
import { pausarIA } from "@/lib/ia-whatsapp/estado";
import { createServiceClient } from "@/lib/supabase/service";

export type ContextoFerramenta = {
  telefone: string;
  instancia: string | null;
  config: IaWhatsappConfig;
  /** Marca efeitos que mudam o que fazer com a resposta final. */
  efeitos: {
    encaminhamentoEnviado: boolean;
    clienteJaAvisado: boolean;
    /** Pediu atendimento humano: a IA pausa depois de mandar a resposta deste turno. */
    transferidoParaHumano: boolean;
  };
};

type Params = Record<string, unknown>;

function texto(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function booleano(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const t = texto(v)?.toLowerCase();
  if (!t) return null;
  if (["true", "sim", "yes", "1"].includes(t)) return true;
  if (["false", "não", "nao", "no", "0"].includes(t)) return false;
  return null;
}

function cpfDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

function str(descricao: string) {
  return { type: "string", description: descricao } as const;
}

// ---------------------------------------------------------------- definições

export const FERRAMENTAS = [
  {
    type: "function",
    name: "atualizar_dados_caso",
    description:
      "Preenche/atualiza a FICHA DO CASO no painel do escritório conforme os dados aparecem na conversa. Chame sempre que descobrir um dado novo do cliente: nome, CPF, data de nascimento, benefício desejado, área (rural | urbano | assistencial), tipo de segurado, se o INSS já negou e o motivo, se já tem processo, se já recebe benefício, requisitos preenchidos/pendentes, pontos de análise jurídica e benefícios alternativos. Envie SOMENTE os campos novos — os demais deixe vazios; nada é apagado. Não espere o fim da triagem: atualize aos poucos.",
    parameters: {
      type: "object",
      properties: {
        nome: str("Nome completo do cliente, se informado."),
        cpf: str("CPF do cliente, se informado."),
        data_nascimento: str("Data de nascimento DD/MM/AAAA, se informada."),
        beneficio_identificado: str("Benefício identificado, ex.: Aposentadoria por Idade Rural."),
        area: str("rural | urbano | assistencial"),
        tipo_segurado: str("Ex.: segurado especial, empregado, contribuinte individual."),
        ja_negou_inss: str("sim | não | vazio se não souber"),
        motivo_negativa: str("Motivo da negativa do INSS, se houve."),
        ja_tem_processo: str("sim | não | vazio se não souber"),
        ja_recebe_beneficio: str("Qual benefício já recebe, se algum."),
        requisitos_preenchidos: str("Requisitos que o cliente já demonstrou preencher."),
        requisitos_pendentes: str("Requisitos ainda não comprovados."),
        pontos_analise_juridica: str("Dúvidas/pontos para o advogado analisar."),
        beneficios_alternativos: str("Outros benefícios possivelmente cabíveis."),
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "consultar_cliente_kanban",
    description:
      "Consulta em qual coluna do funil Kanban o cliente está no painel do escritório. Use no início da conversa, ao retomar um contato, ou ANTES de chamar mover_cliente_kanban. Retorna: coluna, status, nome, CPF, benefício identificado, documentos recebidos e faltantes. Se encontrado=false, o cliente ainda não está no funil.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "mover_cliente_kanban",
    description:
      "Move o cliente no funil Kanban. Chame APENAS quando a intenção mudar ou ficar clara — não a cada mensagem. Antes de mover, prefira consultar_cliente_kanban.\n\nColunas (campo coluna):\n- em_atendimento = cliente novo ou intenção indefinida\n- consultar_processo = quer andamento (ainda organizando)\n- abertura_processo = benefício novo ainda coletando docs\n- aguardando_analise = organização concluída / caixa de pendências da equipe (destino padrão — o sistema envia a mensagem fixa de encaminhamento)\n- aguardando_aprovacao = após enviar_para_aprovacao_advogado (consulta de processo)\n- atendimento_humano = pediu falar com advogado/atendente ou o caso precisa de uma pessoa (o sistema avisa a equipe no grupo e você para de responder este cliente; avise o cliente que uma pessoa da equipe vai continuar o atendimento)\n- processo_finalizado = caso encerrado\n\nSempre informe motivo curto.",
    parameters: {
      type: "object",
      properties: {
        coluna: str(
          "em_atendimento | consultar_processo | abertura_processo | aguardando_analise | aguardando_aprovacao | atendimento_humano | processo_finalizado"
        ),
        motivo: str("Breve motivo da movimentação, 1 frase."),
        nome_cliente: str("Nome do cliente se já informado."),
      },
      required: ["coluna", "motivo"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "registrar_documento_cliente",
    description:
      "Use quando o cliente enviar foto ou PDF e você identificar qual documento é (RG, CPF, certidão, laudo etc.). Envie a url_media que aparece na mensagem, o nome e uma descrição. Atualiza o que já foi recebido e o que ainda falta. Chame assim que identificar — não espere o fim da triagem.",
    parameters: {
      type: "object",
      properties: {
        nome_documento: str("Nome do documento identificado, ex.: RG, CPF, Certidão de óbito."),
        descricao: str("Descrição curta do que foi enviado."),
        url_media: str("url_media exatamente como veio na mensagem do cliente."),
        nome_cliente: str("Nome do cliente se já informado."),
        cpf: str("CPF do cliente se já informado."),
      },
      required: ["nome_documento", "url_media"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "checklist_beneficios",
    description:
      "Consulta no painel do escritório quais documentos cobrar do cliente conforme o tipo de benefício/caso. Chame SEMPRE ao identificar a demanda ou o benefício desejado, e ANTES de listar documentos ao cliente — não invente lista. Com beneficio preenchido retorna o melhor match (match.documentos). Sem beneficio (vazio) retorna todos os tipos ativos.",
    parameters: {
      type: "object",
      properties: {
        beneficio: str(
          "Texto do benefício/demanda (ex.: auxílio por incapacidade, BPC, aposentadoria rural). Vazio para listar todos."
        ),
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "registrar_caso_para_advogado",
    description:
      "Use no FINAL da organização de caso NOVO (CPF + demanda + checklist/docs). Grava o caso para o advogado e avisa a equipe. Em seguida chame mover_cliente_kanban com coluna aguardando_analise. Relatório curto e factual. Chame só uma vez por caso. NÃO use para consulta de processo (aí use enviar_para_aprovacao_advogado).",
    parameters: {
      type: "object",
      properties: {
        nome_cliente: str("Nome do cliente."),
        cpf: str("CPF do cliente."),
        beneficio_identificado: str("Benefício identificado, ex.: Aposentadoria por Idade Rural."),
        area: str("rural | urbano | assistencial"),
        relatorio: str("Relatório curto e factual da conversa."),
        documentos_recebidos: str("Documentos recebidos."),
        documentos_faltantes: str("Documentos que faltam."),
        pontos_analise_juridica: str("Pontos para análise jurídica, se houver."),
      },
      required: ["relatorio"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "enviar_para_aprovacao_advogado",
    description:
      "OBRIGATÓRIO antes de dar qualquer informação de processo ao cliente. Envia o resumo em linguagem simples para o advogado revisar e aprovar. A informação NUNCA é enviada direto ao cliente. O sistema já avisa o cliente que a consulta foi feita e pausa a IA até o advogado decidir.",
    parameters: {
      type: "object",
      properties: {
        nome_cliente: str("Nome do cliente."),
        cpf: str("CPF do cliente."),
        numero_processo: str("Número do processo (exatamente como veio da base)."),
        resumo: str("Resumo em linguagem simples para o advogado aprovar."),
      },
      required: ["resumo"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "buscar_processos_por_cpf",
    description:
      "Busca na base interna do escritório os processos vinculados a um CPF. Use SEMPRE que o cliente quiser saber do andamento do processo. Retorna: nome, cpf, data_nascimento, numero_processo, tribunal, area, descricao_caso. Vazio = CPF sem processo na base do escritório.",
    parameters: {
      type: "object",
      properties: { cpf: str("CPF informado pelo cliente, com ou sem pontuação.") },
      required: ["cpf"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "consultar_processo_datajud",
    description:
      "Consulta as últimas movimentações de um processo na base oficial do Judiciário (DataJud/CNJ). Recebe o número CNJ obtido antes por buscar_processos_por_cpf. Retorna classe, órgão julgador, assuntos e as últimas movimentações. NUNCA invente o número do processo.",
    parameters: {
      type: "object",
      properties: { numero_processo: str("Número CNJ exatamente como veio da base.") },
      required: ["numero_processo"],
      additionalProperties: false,
    },
  },
] as const;

// ---------------------------------------------------------------- execução

async function atualizarDadosCaso(p: Params, ctx: ContextoFerramenta) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("atualizar_dados_caso", {
    p_telefone: ctx.telefone,
    p_nome: texto(p.nome),
    p_cpf: texto(p.cpf),
    p_data_nascimento: texto(p.data_nascimento),
    p_beneficio_identificado: texto(p.beneficio_identificado),
    p_area: texto(p.area),
    p_tipo_segurado: texto(p.tipo_segurado),
    p_ja_negou_inss: booleano(p.ja_negou_inss),
    p_motivo_negativa: texto(p.motivo_negativa),
    p_ja_tem_processo: booleano(p.ja_tem_processo),
    p_ja_recebe_beneficio: texto(p.ja_recebe_beneficio),
    p_requisitos_preenchidos: texto(p.requisitos_preenchidos),
    p_requisitos_pendentes: texto(p.requisitos_pendentes),
    p_pontos_analise_juridica: texto(p.pontos_analise_juridica),
    p_beneficios_alternativos: texto(p.beneficios_alternativos),
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, caso_id: row?.caso_id, status: row?.status, campos_atualizados: row?.campos_atualizados };
}

async function consultarKanban(ctx: ContextoFerramenta) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("consultar_cliente_kanban", { p_telefone: ctx.telefone });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? { encontrado: false };
}

async function moverKanban(p: Params, ctx: ContextoFerramenta) {
  const coluna = texto(p.coluna);
  if (!coluna) return { ok: false, erro: "coluna é obrigatória" };

  let permitidas: string[] = CASO_STATUS.map((s) => s.value);
  try {
    const cols = await listKanbanColunas({ includeInactive: false, service: true, allowFallback: true });
    if (cols.length) permitidas = cols.map((c) => c.chave);
  } catch {
    // usa as padrão
  }
  if (!permitidas.includes(coluna)) {
    return { ok: false, erro: `coluna inválida. Use: ${permitidas.join(", ")}` };
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("mover_cliente_kanban", {
    p_telefone: ctx.telefone,
    p_status: coluna,
    p_motivo: texto(p.motivo),
    p_nome_cliente: texto(p.nome_cliente),
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;

  let mensagemFixaEnviada = false;
  if (coluna === "aguardando_analise" && row?.caso_id != null) {
    const r = await enviarEncaminhamentoAnaliseSePendente([Number(row.caso_id)]);
    mensagemFixaEnviada = r.enviada;
    if (r.enviada) ctx.efeitos.encaminhamentoEnviado = true;
  }

  if (coluna === "atendimento_humano" && !ctx.efeitos.transferidoParaHumano) {
    ctx.efeitos.transferidoParaHumano = true;
    const nome = texto(p.nome_cliente);
    const aviso = [
      "🙋 *ATENDIMENTO HUMANO SOLICITADO*",
      "_A IA parou de responder este cliente. Assuma a conversa pelo painel ou pelo celular._",
      "",
      `👤 Cliente: ${nome ?? "—"}`,
      `📱 WhatsApp: ${ctx.telefone}`,
      `📝 Motivo: ${texto(p.motivo) ?? "—"}`,
      "",
      `Abrir a conversa: ${urlPainel()}/atendimentos?contact=${ctx.telefone}`,
    ].join("\n");
    const avisado = await enviarParaAdvogado(ctx.config.grupo_advogado, aviso);
    return {
      ok: true,
      caso_id: row?.caso_id,
      status: row?.status,
      equipe_avisada: avisado,
      instrucao:
        "A equipe foi avisada e vai assumir. Diga ao cliente, em uma mensagem curta, que uma pessoa da equipe vai continuar o atendimento por aqui. Depois disso você não responde mais este cliente.",
    };
  }

  return {
    ok: true,
    caso_id: row?.caso_id,
    status: row?.status,
    ...(mensagemFixaEnviada
      ? {
          mensagem_fixa_enviada: MENSAGEM_ENCAMINHAMENTO_ANALISE,
          instrucao: "A mensagem fixa de encaminhamento JÁ foi enviada ao cliente. Não repita.",
        }
      : {}),
  };
}

async function registrarDocumento(p: Params, ctx: ContextoFerramenta) {
  const nome = texto(p.nome_documento);
  const url = texto(p.url_media);
  if (!nome || !url) return { ok: false, erro: "nome_documento e url_media são obrigatórios" };

  const supabase = createServiceClient();
  const { data: msg } = await supabase
    .from("mensagens")
    .select("id, mensagem_id")
    .eq("conteudo_media", url)
    .maybeSingle();

  const { data, error } = await supabase.rpc("registrar_documento_cliente", {
    p_nome_documento: nome,
    p_url_media: url,
    p_descricao: texto(p.descricao),
    p_telefone: ctx.telefone,
    p_cpf: texto(p.cpf),
    p_caso_id: null,
    p_mensagem_id: msg?.mensagem_id ?? null,
    p_mensagem_row_id: msg?.id ?? null,
    p_origem: "whatsapp",
    p_nome_cliente: texto(p.nome_cliente),
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    documento_id: row?.documento_id,
    documentos_recebidos: row?.documentos_recebidos,
    documentos_faltantes: row?.documentos_faltantes,
  };
}

async function checklist(p: Params) {
  const tipos = await listTiposCaso({ service: true });
  const publico = (t: { chave: string; label: string; aliases: string[]; documentos: string[] }) => ({
    chave: t.chave,
    label: t.label,
    aliases: t.aliases,
    documentos: t.documentos,
  });
  const beneficio = texto(p.beneficio);
  if (beneficio) return { match: publico(matchTipoCaso(tipos, beneficio)), beneficio };
  return { tipos: tipos.map(publico) };
}

async function registrarCaso(p: Params, ctx: ContextoFerramenta) {
  const supabase = createServiceClient();
  const campos = {
    nome: texto(p.nome_cliente),
    cpf: texto(p.cpf),
    beneficio_identificado: texto(p.beneficio_identificado),
    area: texto(p.area),
    relatorio: texto(p.relatorio),
    documentos_recebidos: texto(p.documentos_recebidos),
    documentos_faltantes: texto(p.documentos_faltantes),
    pontos_analise_juridica: texto(p.pontos_analise_juridica),
  };
  const preenchidos = Object.fromEntries(
    Object.entries(campos).filter(([, v]) => v != null)
  ) as Partial<typeof campos>;

  // Um caso por cliente no funil: atualiza o existente em vez de criar outro.
  const kanban = (await consultarKanban(ctx)) as { encontrado?: boolean; caso_id?: number | null };
  let casoId = kanban.encontrado && kanban.caso_id ? Number(kanban.caso_id) : null;
  if (casoId) {
    const { error } = await supabase.from("casos_novos").update(preenchidos).eq("id", casoId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase
      .from("casos_novos")
      .insert({ ...preenchidos, telefone: ctx.telefone, status: "em_atendimento" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    casoId = data.id;
  }

  const linha = (v: string | null) => v ?? "—";
  const aviso = [
    `🆕 *NOVO CASO PRONTO #${casoId}*`,
    "_Cliente passou os dados. Falta criar/protocolar o processo._",
    "",
    `👤 Cliente: ${linha(campos.nome)}`,
    `📱 WhatsApp: ${ctx.telefone}`,
    `🪪 CPF: ${linha(campos.cpf)}`,
    `⚖️ Benefício: ${linha(campos.beneficio_identificado)}${campos.area ? ` (${campos.area})` : ""}`,
    "",
    "📎 *Documentos recebidos:*",
    linha(campos.documentos_recebidos),
    "",
    "❗ *Documentos faltantes:*",
    linha(campos.documentos_faltantes),
    ...(campos.pontos_analise_juridica
      ? ["", "🔎 *Pontos para análise jurídica:*", campos.pontos_analise_juridica]
      : []),
    "",
    "📝 *Relatório:*",
    linha(campos.relatorio),
    "",
    `Abrir no painel: ${urlPainel()}/kanban/${casoId}`,
  ].join("\n");
  const avisado = await enviarParaAdvogado(ctx.config.grupo_advogado, aviso);

  return {
    status: "CASO_REGISTRADO",
    caso_id: casoId,
    advogado_avisado: avisado,
    instrucao:
      "Caso registrado e a equipe foi avisada. Agora chame mover_cliente_kanban com coluna aguardando_analise. NÃO prometa concessão do benefício, prazo nem resultado.",
  };
}

async function enviarParaAprovacao(p: Params, ctx: ContextoFerramenta) {
  const resumo = texto(p.resumo);
  if (!resumo) return { ok: false, erro: "resumo é obrigatório" };
  const nome = texto(p.nome_cliente);

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("aprovacoes_pendentes")
    .insert({
      telefone_cliente: ctx.telefone,
      nome_cliente: nome,
      cpf: texto(p.cpf),
      numero_processo: texto(p.numero_processo),
      resumo,
      instancia: ctx.instancia,
      status: "pendente",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const id = data.id;

  await pausarIA(ctx.telefone, "aprovacao");

  const aviso = [
    `⚖️ *APROVAÇÃO PENDENTE #${id}*`,
    "",
    `Aprovar pelo sistema: ${urlPainel()}/aprovacoes/${id}`,
    "",
    `👤 Cliente: ${nome ?? "—"}`,
    `📱 WhatsApp: ${ctx.telefone}`,
    `🪪 CPF: ${texto(p.cpf) ?? "—"}`,
    `📄 Processo: ${texto(p.numero_processo) ?? "—"}`,
    "",
    "📝 *Resumo que a IA quer enviar:*",
    "",
    resumo,
    "",
    "———",
    "Responda aqui:",
    `✅ *#aprovar ${id}* — envia o resumo acima ao cliente`,
    `✏️ *#responder ${id} <seu texto>* — envia o seu texto no lugar`,
    `❌ *#recusar ${id}* — descarta (cliente continua pausado para atendimento humano)`,
  ].join("\n");
  const avisado = await enviarParaAdvogado(ctx.config.grupo_advogado, aviso);

  const primeiroNome = nome?.split(/\s+/)[0];
  await enviarTextoCliente({
    telefone: ctx.telefone,
    instancia: ctx.instancia,
    texto: `Pronto${primeiroNome ? `, ${primeiroNome}` : ""}! Já fiz a consulta do seu processo. O advogado responsável vai revisar e eu te passo mais informações em breve.`,
  });
  ctx.efeitos.clienteJaAvisado = true;

  return {
    status: "ENVIADO_PARA_APROVACAO",
    id_aprovacao: id,
    advogado_avisado: avisado,
    instrucao:
      "O cliente JÁ foi avisado de que o advogado vai revisar e a IA ficou pausada para ele. Não envie mais nada sobre o processo. NÃO revele o resumo.",
  };
}

async function buscarProcessos(p: Params) {
  const digitos = cpfDigitos(p.cpf);
  if (digitos.length !== 11) return { ok: false, erro: "CPF precisa ter 11 dígitos", processos: [] };
  const formatado = `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("processos_clientes")
    .select("nome, cpf, data_nascimento, numero_processo, tribunal, area, descricao_caso")
    .eq("ativo", true)
    .in("cpf", [digitos, formatado]);
  if (error) throw new Error(error.message);
  return {
    processos: (data ?? []).map((r) => ({
      ...r,
      data_nascimento: r.data_nascimento ? r.data_nascimento.split("-").reverse().join("/") : null,
      numero_processo: r.numero_processo ?? "(ainda sem número)",
    })),
  };
}

async function consultarProcesso(p: Params) {
  const numero = texto(p.numero_processo);
  if (!numero) return { resultado: "ERRO", texto: "numero_processo é obrigatório" };
  const r = await consultarDataJud(numero);
  if (!r.encontrado) return { resultado: "NAO_ENCONTRADO", texto: r.motivo };
  return {
    resultado: "OK",
    processo: {
      tribunal: r.tribunal,
      grau: r.grau,
      classe: r.classe,
      assuntos: r.assuntos.join(", "),
      orgaoJulgador: r.orgaoJulgador,
      dataAjuizamento: r.dataAjuizamento,
      ultimaAtualizacao: r.ultimaAtualizacao,
      ultimasMovimentacoes: r.movimentos
        .slice(0, 5)
        .map((m) => `${m.data} — ${m.nome}${m.complemento ? ` (${m.complemento})` : ""}`),
    },
  };
}

export async function executarFerramenta(
  nome: string,
  params: Params,
  ctx: ContextoFerramenta
): Promise<unknown> {
  switch (nome) {
    case "atualizar_dados_caso":
      return atualizarDadosCaso(params, ctx);
    case "consultar_cliente_kanban":
      return consultarKanban(ctx);
    case "mover_cliente_kanban":
      return moverKanban(params, ctx);
    case "registrar_documento_cliente":
      return registrarDocumento(params, ctx);
    case "checklist_beneficios":
      return checklist(params);
    case "registrar_caso_para_advogado":
      return registrarCaso(params, ctx);
    case "enviar_para_aprovacao_advogado":
      return enviarParaAprovacao(params, ctx);
    case "buscar_processos_por_cpf":
      return buscarProcessos(params);
    case "consultar_processo_datajud":
      return consultarProcesso(params);
    default:
      return { ok: false, erro: `Ferramenta desconhecida: ${nome}` };
  }
}
