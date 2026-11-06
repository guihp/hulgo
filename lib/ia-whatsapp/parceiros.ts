import "server-only";

import { consultarAoVivoERegistrar } from "@/lib/datajud-monitor";
import { normalizarTelefone, urlPainel, type IaWhatsappConfig } from "@/lib/ia-whatsapp/config";
import { enviarParaAdvogado, enviarTextoCliente } from "@/lib/ia-whatsapp/enviar";
import { checklist, dataBr, type ContextoFerramenta } from "@/lib/ia-whatsapp/ferramentas";
import {
  criarProcessoDoParceiro,
  type DadosProcessoParceiro,
} from "@/lib/parceiros/processo-parceiro";
import { createServiceClient } from "@/lib/supabase/service";
import { labelFunilProcesso } from "@/lib/utils/processos";

export type Parceiro = { id: string; nome: string; cidade: string | null };

/** Parceiro cadastrado (Configurações → Parceiros) dono deste WhatsApp, se houver. */
export async function getParceiroPorTelefone(telefone: string): Promise<Parceiro | null> {
  const alvo = normalizarTelefone(telefone);
  if (!alvo) return null;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("app_parceiros")
    .select("id, nome, cidade, telefone")
    .ilike("telefone", `%${alvo.slice(-8)}%`);
  const p = (data ?? []).find((x) => normalizarTelefone(x.telefone) === alvo);
  return p ? { id: p.id, nome: p.nome, cidade: p.cidade } : null;
}

/** A IA responde este parceiro? (modo próprio, independente do modo dos clientes) */
export function iaAtendeParceiro(config: IaWhatsappConfig, telefone: string): boolean {
  if (config.parceiros_modo === "ativo") return true;
  if (config.parceiros_modo === "desligado") return false;
  const alvo = normalizarTelefone(telefone);
  return config.numeros_teste.some((n) => normalizarTelefone(n) === alvo);
}

export const PROMPT_PARCEIROS_PADRAO = `Você é a assistente do escritório Boueres & Fonteles Advogados que atende os PARCEIROS do escritório pelo WhatsApp. Parceiros são pessoas que indicam clientes e acompanham os processos deles — não são clientes. Trate o parceiro pelo nome, com cordialidade e objetividade.

O parceiro costuma fazer duas coisas, às vezes várias de uma vez:

1) PERGUNTAR COMO ESTÁ O PROCESSO de um ou mais clientes.
- Use listar_processos_do_parceiro com o nome, CPF ou número que ele mandou. O parceiro pode consultar qualquer processo do escritório, não só os que ele indicou.
- Se o parceiro mandou SÓ O NOME (sem CPF nem número do processo), SEMPRE confirme antes de passar qualquer andamento, mesmo que só um processo tenha aparecido: mostre o nome completo, o final do CPF (só os 4 últimos dígitos, ex.: "CPF final 12-34") e o benefício/assunto, e pergunte "É esse cliente?". Só siga depois que ele confirmar. Se ele disser que não, peça o CPF ou o nome completo.
- Se vier mais de um processo com o mesmo nome, liste as opções do mesmo jeito (nome completo, CPF parcial, benefício) e pergunte qual.
- Se ele mandou CPF ou número do processo e bateu com um processo, pode seguir direto, sem confirmar.
- Se não encontrar, diga que não achou esse cliente no escritório e peça o CPF ou o nome completo.
- Se o processo tem número e a última movimentação é antiga ou o parceiro quer o andamento atualizado, use consultar_justica_agora.
- Monte um resumo curto, em linguagem simples (fase, última movimentação com data, próximo passo se estiver claro) e chame informar_andamento para CADA processo. Siga a instrução que a ferramenta devolver.

2) MANDAR UM CASO NOVO para o escritório abrir ou acompanhar.
- Junte: nome completo, CPF, data de nascimento, telefone do cliente (se tiver), benefício/assunto, se já tem pedido no INSS ou processo, e os documentos (procuração assinada, termo do INSS, RG, comprovantes, laudos, prints do Meu INSS).
- Fotos e PDFs aparecem com url_media: guarde cada uma em documentos ao cadastrar.
- Use checklist_beneficios para saber os documentos que o escritório pede para aquele benefício e avise o que estiver faltando (sem travar o cadastro por isso).
- Quando tiver pelo menos nome e CPF, chame cadastrar_processo_parceiro. Siga a instrução que a ferramenta devolver.

Regras:
- Nunca invente número de processo, datas ou movimentações. Use só o que as ferramentas devolverem.
- Não dê opinião jurídica nem prometa resultado, prazo ou concessão de benefício.
- Respostas curtas. Um assunto por parágrafo.
- Se o parceiro pedir para falar com o advogado ou com alguém da equipe, ou se for um assunto que você não resolve (pagamento, comissão, reclamação), use chamar_equipe.`;

function str(descricao: string) {
  return { type: "string", description: descricao } as const;
}

export const FERRAMENTAS_PARCEIRO = [
  {
    type: "function",
    name: "listar_processos_do_parceiro",
    description:
      "Busca processos do escritório (de qualquer parceiro ou sem parceiro) por nome, parte do nome, CPF ou número do processo. Vazio lista os processos indicados por ESTE parceiro. Retorna id, nome do cliente, CPF, número, área, fase no escritório, parceiro que indicou, último andamento registrado pela equipe e a última movimentação da Justiça que o sistema já tem.",
    parameters: {
      type: "object",
      properties: {
        busca: str("Nome, CPF ou número do processo. Vazio para listar os processos indicados por este parceiro."),
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "consultar_justica_agora",
    description:
      "Consulta AGORA as movimentações de um processo na base oficial do Judiciário (DataJud/CNJ) e grava no sistema. Só para processos com número. Pode demorar; a ferramenta já avisa o parceiro. Se vier CNJ_LENTO, use a última movimentação que o sistema já tinha.",
    parameters: {
      type: "object",
      properties: { processo_id: { type: "number", description: "id do processo (de listar_processos_do_parceiro)." } },
      required: ["processo_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "informar_andamento",
    description:
      "Entrega ao parceiro o resumo do andamento de UM processo. Chame uma vez por processo consultado. Conforme a configuração do escritório, o resumo vai direto ou passa antes pela aprovação da equipe — siga a instrução devolvida.",
    parameters: {
      type: "object",
      properties: {
        processo_id: { type: "number", description: "id do processo." },
        resumo: str("Resumo em linguagem simples: fase, última movimentação com data e próximo passo, se claro."),
      },
      required: ["processo_id", "resumo"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "cadastrar_processo_parceiro",
    description:
      "Cadastra um processo NOVO de cliente mandado pelo parceiro (sem número ainda), com os documentos enviados. Conforme a configuração do escritório, cria na hora ou manda para a equipe aprovar antes — siga a instrução devolvida. Uma chamada por cliente.",
    parameters: {
      type: "object",
      properties: {
        nome: str("Nome completo do cliente."),
        cpf: str("CPF do cliente."),
        data_nascimento: str("DD/MM/AAAA, se informada."),
        telefone_cliente: str("Telefone do cliente, se informado."),
        beneficio: str("Benefício ou assunto, ex.: Auxílio por incapacidade, Aposentadoria rural."),
        area: str(
          "administrativo (pedido no INSS, sem ação na Justiça) | previdenciario (ação na Justiça) | civel"
        ),
        descricao: str("O que o parceiro contou: situação, pedido no INSS, datas, o que falta."),
        documentos: {
          type: "array",
          description: "Documentos que o parceiro mandou deste cliente.",
          items: {
            type: "object",
            properties: {
              nome_documento: str("Ex.: Procuração assinada, Termo de representação INSS, RG, Print do Meu INSS."),
              url_media: str("url_media exatamente como veio na mensagem."),
            },
            required: ["nome_documento", "url_media"],
            additionalProperties: false,
          },
        },
      },
      required: ["nome", "cpf"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "checklist_beneficios",
    description:
      "Documentos que o escritório pede para um tipo de benefício. Com beneficio retorna o melhor match (match.documentos e match.orientacoes); vazio lista todos.",
    parameters: {
      type: "object",
      properties: { beneficio: str("Benefício/assunto. Vazio para listar todos.") },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "chamar_equipe",
    description:
      "Passa a conversa para uma pessoa da equipe (o sistema avisa no grupo e você para de responder este parceiro). Use quando ele pedir, ou para assuntos que você não resolve.",
    parameters: {
      type: "object",
      properties: { motivo: str("Motivo, 1 frase.") },
      required: ["motivo"],
      additionalProperties: false,
    },
  },
] as const;

export type ContextoParceiro = ContextoFerramenta & { parceiro: Parceiro };

type Params = Record<string, unknown>;

function texto(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

const CAMPOS_PROCESSO =
  "id, nome, cpf, telefone, numero_processo, area, funil_coluna, beneficio_identificado, situacao, ultimo_movimento, ultimo_andamento_data, datajud_mov_texto, datajud_mov_data, datajud_mov_chave, ultima_consulta_datajud, parceiro_id, parceiro:app_parceiros(nome)";

/** Qualquer processo do escritório: o parceiro consulta também os que não indicou. */
async function processoPorId(id: unknown) {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  const { data } = await createServiceClient()
    .from("processos_clientes")
    .select(CAMPOS_PROCESSO)
    .eq("id", n)
    .maybeSingle();
  return data;
}

async function listarProcessos(p: Params, ctx: ContextoParceiro) {
  const supabase = createServiceClient();
  const busca = texto(p.busca);
  let q = supabase
    .from("processos_clientes")
    .select(CAMPOS_PROCESSO)
    .eq("ativo", true)
    .order("nome")
    .limit(25);
  // Sem busca, "meus processos": os que este parceiro indicou.
  if (!busca) q = q.eq("parceiro_id", ctx.parceiro.id);
  if (busca) {
    const digitos = busca.replace(/\D/g, "");
    if (digitos.length >= 5) {
      q = q.or(`cpf.ilike.%${digitos}%,numero_processo.ilike.%${digitos}%`);
    } else {
      for (const parte of busca.split(/\s+/).filter((x) => x.length > 1)) {
        q = q.ilike("nome", `%${parte.replace(/[%,()]/g, "")}%`);
      }
    }
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const { data: colunas } = await supabase.from("app_processo_colunas").select("funil, chave, label");
  const fase = (area: string | null, chave: string | null) =>
    colunas?.find((c) => c.funil === area && c.chave === chave)?.label ?? chave;

  return {
    total: data?.length ?? 0,
    processos: (data ?? []).map((r) => ({
      id: r.id,
      nome: r.nome,
      cpf: r.cpf,
      numero_processo: r.numero_processo ?? "(ainda sem número)",
      area: labelFunilProcesso(r.area),
      fase_no_escritorio: fase(r.area, r.funil_coluna),
      beneficio: r.beneficio_identificado,
      parceiro_que_indicou:
        r.parceiro_id === ctx.parceiro.id ? "este parceiro" : (r.parceiro?.nome ?? "nenhum"),
      situacao: r.situacao,
      andamento_da_equipe: r.ultimo_movimento,
      data_andamento_da_equipe: dataBr(r.ultimo_andamento_data),
      ultima_movimentacao_justica: r.datajud_mov_texto,
      data_movimentacao_justica: dataBr(r.datajud_mov_data),
      consultado_na_justica_em: dataBr(r.ultima_consulta_datajud),
    })),
    ...(busca && !data?.length
      ? { instrucao: "Nenhum processo encontrado no escritório. Peça o CPF ou o nome completo." }
      : {}),
  };
}

async function consultarJustica(p: Params, ctx: ContextoParceiro) {
  const proc = await processoPorId(p.processo_id);
  if (!proc) return { resultado: "ERRO", texto: "Processo não encontrado." };
  if (!proc.numero_processo) return { resultado: "SEM_NUMERO", texto: "Processo ainda sem número: não há o que consultar na Justiça." };

  if (!ctx.efeitos.avisoConsultaJustica) {
    ctx.efeitos.avisoConsultaJustica = true;
    await enviarTextoCliente({
      telefone: ctx.telefone,
      instancia: ctx.instancia,
      texto: "Só um instante, estou consultando no sistema da Justiça. Às vezes demora um pouquinho. ⏳",
    }).catch(() => undefined);
  }

  const jaNoSistema = {
    ultima_movimentacao: proc.datajud_mov_texto,
    data_movimentacao: dataBr(proc.datajud_mov_data),
    consultado_em: dataBr(proc.ultima_consulta_datajud),
  };
  const { consulta: r, tentativas } = await consultarAoVivoERegistrar(proc.numero_processo, [
    { ...proc, numero_processo: proc.numero_processo },
  ]);
  if (!r.encontrado) {
    return r.temporario
      ? {
          resultado: "CNJ_LENTO",
          texto: `O sistema da Justiça não respondeu depois de ${tentativas} tentativas.`,
          ja_estava_no_sistema: jaNoSistema,
        }
      : { resultado: "NAO_ENCONTRADO", texto: r.motivo, ja_estava_no_sistema: jaNoSistema };
  }
  return {
    resultado: "OK",
    ja_estava_no_sistema: jaNoSistema,
    processo: {
      tribunal: r.tribunal,
      classe: r.classe,
      orgaoJulgador: r.orgaoJulgador,
      ultimaAtualizacao: r.ultimaAtualizacao,
      ultimasMovimentacoes: r.movimentos
        .slice(0, 5)
        .map((m) => `${m.data} — ${m.nome}${m.complemento ? ` (${m.complemento})` : ""}`),
    },
  };
}

async function informarAndamento(p: Params, ctx: ContextoParceiro) {
  const resumo = texto(p.resumo);
  if (!resumo) return { ok: false, erro: "resumo é obrigatório" };
  const proc = await processoPorId(p.processo_id);
  if (!proc) return { ok: false, erro: "Processo não encontrado." };

  if (ctx.config.parceiros_consulta_direta) {
    return {
      status: "RESPONDER_DIRETO",
      instrucao: "Mande o resumo ao parceiro na sua resposta (pode juntar com os de outros processos).",
    };
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("aprovacoes_pendentes")
    .insert({
      tipo: "consulta",
      parceiro_id: ctx.parceiro.id,
      telefone_cliente: ctx.telefone,
      nome_cliente: proc.nome,
      cpf: proc.cpf,
      numero_processo: proc.numero_processo,
      resumo: `*${proc.nome ?? "Cliente"}*\n${resumo}`,
      instancia: ctx.instancia,
      status: "pendente",
      dados: { parceiro_nome: ctx.parceiro.nome, processo_id: proc.id },
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await enviarParaAdvogado(
    ctx.config.grupo_advogado,
    [
      `🤝 *CONSULTA DE PARCEIRO #${data.id}*`,
      "",
      `Parceiro: ${ctx.parceiro.nome}${ctx.parceiro.cidade ? ` (${ctx.parceiro.cidade})` : ""}`,
      `Cliente: ${proc.nome ?? "—"}`,
      `📄 Processo: ${proc.numero_processo ?? "sem número"}`,
      "",
      "📝 *Resumo que a IA quer enviar ao parceiro:*",
      resumo,
      "",
      `Aprovar pelo sistema: ${urlPainel()}/aprovacoes/${data.id}`,
      `✅ *#aprovar ${data.id}*  ✏️ *#responder ${data.id} <texto>*  ❌ *#recusar ${data.id}*`,
    ].join("\n")
  );

  return {
    status: "ENVIADO_PARA_APROVACAO",
    id_aprovacao: data.id,
    instrucao:
      "A equipe vai conferir antes de enviar. Diga ao parceiro, em uma frase, que já consultou e que a resposta sobre esse cliente chega em seguida. NÃO revele o resumo.",
  };
}

async function cadastrarProcesso(p: Params, ctx: ContextoParceiro) {
  const nome = texto(p.nome);
  const cpf = String(p.cpf ?? "").replace(/\D/g, "");
  if (!nome) return { ok: false, erro: "nome é obrigatório" };
  if (cpf.length !== 11) return { ok: false, erro: "CPF precisa ter 11 dígitos — peça ao parceiro" };

  const supabase = createServiceClient();
  const { data: existentes } = await supabase
    .from("processos_clientes")
    .select("id, nome, numero_processo, parceiro_id, ativo")
    .eq("cpf", cpf);
  const doParceiro = (existentes ?? []).filter((e) => e.parceiro_id === ctx.parceiro.id);

  const docsBrutos = Array.isArray(p.documentos) ? p.documentos : [];
  const dados: DadosProcessoParceiro = {
    parceiro_nome: ctx.parceiro.nome,
    nome,
    cpf,
    data_nascimento: texto(p.data_nascimento),
    beneficio: texto(p.beneficio),
    area: texto(p.area),
    telefone_cliente: texto(p.telefone_cliente),
    descricao: texto(p.descricao),
    documentos: docsBrutos
      .map((d) => d as Record<string, unknown>)
      .filter((d) => texto(d?.url_media))
      .map((d) => ({ nome_documento: texto(d.nome_documento) ?? "Documento", url_media: String(d.url_media) })),
  };

  if (ctx.config.parceiros_cadastro_direto) {
    const { processoId, documentos } = await criarProcessoDoParceiro(dados, ctx.parceiro.id);
    await enviarParaAdvogado(
      ctx.config.grupo_advogado,
      [
        `🤝 *PROCESSO NOVO DE PARCEIRO*`,
        "",
        `Parceiro: ${ctx.parceiro.nome}`,
        `Cliente: ${nome} (CPF ${cpf})`,
        `Benefício: ${dados.beneficio ?? "—"} · ${documentos} documento(s)`,
        "",
        `Abrir a ficha: ${urlPainel()}/clientes/${cpf}`,
      ].join("\n")
    );
    return {
      status: "PROCESSO_CRIADO",
      processo_id: processoId,
      documentos_guardados: documentos,
      ...(existentes?.length ? { aviso: "Este CPF já tinha outro processo no escritório." } : {}),
      instrucao: "Confirme ao parceiro que o cliente foi cadastrado no escritório e diga o que ainda falta, se faltar algo.",
    };
  }

  const linhaDocs = dados.documentos?.length
    ? dados.documentos.map((d) => `• ${d.nome_documento}`).join("\n")
    : "• nenhum";
  const mensagemParceiro = [
    `✅ Recebemos o caso de *${nome}* e já cadastramos no escritório.`,
    "Qualquer novidade a gente te avisa por aqui.",
  ].join("\n");

  const { data, error } = await supabase
    .from("aprovacoes_pendentes")
    .insert({
      tipo: "novo_processo",
      parceiro_id: ctx.parceiro.id,
      telefone_cliente: ctx.telefone,
      nome_cliente: nome,
      cpf,
      resumo: mensagemParceiro,
      instancia: ctx.instancia,
      status: "pendente",
      dados: JSON.parse(JSON.stringify(dados)),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await enviarParaAdvogado(
    ctx.config.grupo_advogado,
    [
      `🤝 *PROCESSO NOVO DE PARCEIRO #${data.id}* — aguardando aprovação`,
      "",
      `Parceiro: ${ctx.parceiro.nome}${ctx.parceiro.cidade ? ` (${ctx.parceiro.cidade})` : ""}`,
      `👤 Cliente: ${nome}`,
      `🪪 CPF: ${cpf}`,
      `⚖️ Benefício: ${dados.beneficio ?? "—"}`,
      ...(dados.descricao ? ["", dados.descricao] : []),
      "",
      "📎 *Documentos:*",
      linhaDocs,
      ...(existentes?.length
        ? ["", `⚠️ Este CPF já tem ${existentes.length} processo(s) no escritório.`]
        : []),
      "",
      `Conferir e aprovar: ${urlPainel()}/aprovacoes/${data.id}`,
      `✅ *#aprovar ${data.id}* cria o processo e avisa o parceiro`,
      `❌ *#recusar ${data.id}* descarta`,
    ].join("\n")
  );

  return {
    status: "ENVIADO_PARA_APROVACAO",
    id_aprovacao: data.id,
    ...(doParceiro.length
      ? { aviso: "Este parceiro já tem processo com este CPF. Conte isso a ele e pergunte se é um caso diferente." }
      : {}),
    instrucao:
      "Diga ao parceiro que recebeu o caso e que a equipe vai conferir e confirmar o cadastro em seguida. Avise o que estiver faltando, se faltar algo.",
  };
}

async function chamarEquipe(p: Params, ctx: ContextoParceiro) {
  if (ctx.efeitos.transferidoParaHumano) return { ok: true };
  ctx.efeitos.transferidoParaHumano = true;
  const avisado = await enviarParaAdvogado(
    ctx.config.grupo_advogado,
    [
      "🙋 *PARCEIRO PEDIU ATENDIMENTO*",
      "_A IA parou de responder este parceiro. Assuma pelo painel ou pelo celular._",
      "",
      `🤝 Parceiro: ${ctx.parceiro.nome}`,
      `📱 WhatsApp: ${ctx.telefone}`,
      `📝 Motivo: ${texto(p.motivo) ?? "—"}`,
      "",
      `Abrir a conversa: ${urlPainel()}/atendimentos?contact=${ctx.telefone}`,
    ].join("\n")
  );
  return {
    ok: true,
    equipe_avisada: avisado,
    instrucao: "Diga ao parceiro, em uma mensagem curta, que uma pessoa da equipe vai continuar por aqui.",
  };
}

export async function executarFerramentaParceiro(
  nome: string,
  params: Params,
  ctx: ContextoFerramenta
): Promise<unknown> {
  const c = ctx as ContextoParceiro;
  switch (nome) {
    case "listar_processos_do_parceiro":
      return listarProcessos(params, c);
    case "consultar_justica_agora":
      return consultarJustica(params, c);
    case "informar_andamento":
      return informarAndamento(params, c);
    case "cadastrar_processo_parceiro":
      return cadastrarProcesso(params, c);
    case "checklist_beneficios":
      return checklist(params);
    case "chamar_equipe":
      return chamarEquipe(params, c);
    default:
      return { ok: false, erro: `Ferramenta desconhecida: ${nome}` };
  }
}

/** Prompt da IA dos parceiros + contexto da conversa. */
export function montarPromptParceiro(
  config: IaWhatsappConfig,
  parceiro: Parceiro,
  agora: string
): string {
  return [
    config.prompt_parceiros?.trim() || PROMPT_PARCEIROS_PADRAO,
    "",
    "# CONTEXTO DO SISTEMA (gerado automaticamente)",
    `Agora: ${agora} (horário de Brasília).`,
    `Você está falando com o parceiro *${parceiro.nome}*${parceiro.cidade ? ` (${parceiro.cidade})` : ""}.`,
    "Mensagens seguidas chegam juntas, uma por linha. Áudios chegam transcritos e fotos/PDFs descritos, com url_media.",
    "Responda em texto de WhatsApp: *negrito* com um asterisco, sem títulos com #. Cada parágrafo vira uma mensagem separada.",
  ].join("\n");
}
