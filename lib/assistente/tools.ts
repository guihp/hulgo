import { buscarGlobal } from "@/lib/actions/busca";
import {
  getAgenteConfig,
  listAgenteConfigVersoes,
} from "@/lib/actions/configuracoes";
import { getAppUser } from "@/lib/actions/auth";
import { loadFichaPessoa } from "@/lib/data/ficha";
import { listKanbanColunas } from "@/lib/data/kanban-colunas";
import {
  labelDaColunaProcesso,
  listProcessoColunasTodas,
  type ProcessoColunaMatch,
} from "@/lib/data/processo-colunas";
import {
  FUNIL_PROCESSO_PADRAO,
  FUNIS_PROCESSO,
  formatValorCentavos,
  funilTemBeneficio,
  isFunilProcesso,
  labelFunilProcesso,
  normalizeAreaProcesso,
  SITUACOES_PROCESSO,
  situacaoProcessoInfo,
  type FunilProcesso,
} from "@/lib/utils/processos";
import type { Tables } from "@/types/database";
import {
  clipPreview,
  extractPromptSection,
  extractTrechoContext,
  indexPromptSections,
} from "@/lib/assistente/agente-prompt-edit";
import {
  assistenteAtendimentoHref,
  assistenteFichaArquivosHref,
  assistenteFichaHref,
  assistenteKanbanHref,
} from "@/lib/assistente/links";
import { createClient } from "@/lib/supabase/server";
import { brazilCalendarDayBounds } from "@/lib/utils/dates";
import { formatCpf, isValidCpf, normalizeCpf } from "@/lib/utils/cpf";
import { phoneToContactNorm } from "@/lib/utils/phone";
import {
  formatNumeroProcesso,
  isValidNumeroProcesso,
  normalizeNumeroProcesso,
} from "@/lib/utils/processo";
import { listParceiros } from "@/lib/actions/parceiros";
import {
  carregarRelatorioProcessos,
  RelatorioParamError,
} from "@/lib/relatorios/processos-dados";
import { relatorioProcessosHref } from "@/lib/relatorios/processos-href";
import {
  carregarDadosDocumento,
  criarDocumentoGerado,
  documentoGeradoEditorHref,
  documentoGeradoHref,
  montarValoresDocumento,
  VALIDADE_DOCUMENTO_HORAS,
} from "@/lib/documentos/gerados";
import { DOCUMENTOS_TEMPLATES, getDocumentoTemplate } from "@/lib/utils/documentos";
import type {
  AssistentePendingAnexo,
  AssistenteToolResult,
} from "@/lib/assistente/types";
import {
  ASSISTENTE_WRITE_TOOL_DEFINITIONS,
  isWriteTool,
  proposeAssistenteWriteTool,
  WRITE_TOOL_NAMES,
} from "@/lib/assistente/write-tools";

/** Write tools that require UI confirmation before mutating. */
export const ASSISTENTE_TOOLS_NEEDING_CONFIRMATION = WRITE_TOOL_NAMES;

/** Lista compacta dos modelos/campos para a descrição de preencher_documento. */
const CATALOGO_MODELOS = DOCUMENTOS_TEMPLATES.map((t) => {
  const campos = t.campos
    .map((c) =>
      c.tipo === "opcao"
        ? `${c.key}[${(c.opcoes ?? []).map((o) => o.value).filter(Boolean).join("|")}]`
        : c.template
          ? `${c.key} (montado automaticamente)`
          : `${c.key}: ${c.label}`
    )
    .join("; ");
  return `- ${t.slug} (${t.label}): ${campos}`;
}).join("\n");

/** OpenAI function-calling tool definitions (read + write proposals). */
export const ASSISTENTE_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "buscar_pessoas",
      description:
        "Busca clientes/pessoas por nome, CPF, telefone ou benefício. Retorna match_count + pessoas (nome, cpf, telefone). 1=única (confirme); 2+=liste e peça escolha; 0=ofereça criar cliente. Use antes de anexar/obter ficha.",
      parameters: {
        type: "object",
        properties: {
          termo: {
            type: "string",
            description: "Nome, CPF, telefone ou trecho a buscar (mín. 2 caracteres)",
          },
        },
        required: ["termo"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "obter_ficha",
      description:
        "Carrega a ficha 360 de uma pessoa: processos (área/funil, coluna, partes, tipo de ação, vara, valor, situação, último andamento), casos do funil de vendas, prazos e audiências (separadas), contagem de mensagens. Informe cpf e/ou telefone/contact_norm.",
      parameters: {
        type: "object",
        properties: {
          cpf: { type: "string", description: "CPF (com ou sem máscara)" },
          contact_norm: {
            type: "string",
            description: "Telefone ou contact_norm WhatsApp",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "listar_casos",
      description:
        "Lista casos do funil (casos_novos). Filtre por CPF, telefone ou status do kanban.",
      parameters: {
        type: "object",
        properties: {
          cpf: { type: "string" },
          telefone: { type: "string" },
          status: {
            type: "string",
            description:
              "Status do kanban (ex.: aguardando_analise, documentos, aprovacao, etc.)",
          },
          limite: {
            type: "number",
            description: "Máximo de resultados (padrão 20, máx. 40)",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "listar_prazos",
      description:
        "Lista prazos (app_prazos). Filtros: CPF, tipo (ex.: audiencia), próximos N dias, só abertos. Audiências trazem local, modalidade e link.",
      parameters: {
        type: "object",
        properties: {
          cpf: { type: "string" },
          tipo: {
            type: "string",
            description:
              "exigencia_inss | recurso | pericia | audiencia | outro. Use audiencia para 'quais audiências tenho'.",
          },
          dias: {
            type: "number",
            description: "Janela em dias a partir de hoje (ex.: 7). Omitir = todos.",
          },
          apenas_abertos: {
            type: "boolean",
            description: "Se true (padrão), só prazos não concluídos",
          },
          limite: { type: "number", description: "Máximo (padrão 30, máx. 50)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "listar_processos",
      description:
        "Lista processos (processos_clientes) dos 4 funis de processos (administrativos e judiciais). Filtros: funil, coluna (chave), situacao, parceiro_id, texto (nome, CPF ou nº do processo). Retorna cards resumidos com processo_id e link /processos?funil=...",
      parameters: {
        type: "object",
        properties: {
          funil: {
            type: "string",
            description:
              "civel (Cível) | administrativo (Administrativo Previdenciário) | previdenciario (Judicial Previdenciário) | concedido (Concedidos). Omitir = todos.",
          },
          coluna: {
            type: "string",
            description: "Chave da coluna do funil (veja listar_colunas_funis).",
          },
          situacao: {
            type: "string",
            description: `${SITUACOES_PROCESSO.map((s) => s.value).join(" | ")}`,
          },
          parceiro_id: { type: "string", description: "UUID do parceiro" },
          texto: {
            type: "string",
            description: "Nome, CPF ou trecho do número do processo",
          },
          limite: { type: "number", description: "Máximo (padrão 20, máx. 50)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "listar_colunas_funis",
      description:
        "Colunas ATIVAS atuais: funil de vendas/atendimento (casos, mover_kanban/criar_cliente_caso) e os 4 funis de processos — civel, administrativo, previdenciario (judicial), concedido (mover_processo/criar_processo/transferir_processo). Chame antes de mover ou criar para usar chaves válidas.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "gerar_relatorio_processos",
      description:
        "Gera o RELATÓRIO EM PDF dos processos (logo do escritório, resumo e uma seção por coluna). Use quando pedirem relatório/PDF/listagem para imprimir de um funil, de uma coluna ou de todos os funis. Devolve o link do PDF e a contagem por coluna — cite os números e diga para clicar no link. Somente leitura (sem confirmação).",
      parameters: {
        type: "object",
        properties: {
          funil: {
            type: "string",
            description:
              "civel | administrativo | previdenciario (Judicial Previdenciário) | concedido | todos. Omitir = todos.",
          },
          coluna: {
            type: "string",
            description:
              "Chave da coluna (listar_colunas_funis) para relatório de uma coluna só. Exige funil. Omitir = todas as colunas.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "preencher_documento",
      description:
        "Preenche um MODELO de documento do escritório (procuração, termos, autodeclarações, LOAS) e devolve o link do PDF pronto para baixar/imprimir e um link para revisar no editor. Use quando pedirem para preencher/gerar procuração ou outro modelo — normalmente após o usuário enviar foto do RG/CNH e do comprovante de residência (use o texto lido dos anexos no histórico). Dados da ficha do cliente (nome, CPF, nascimento, telefone) entram sozinhos se informar cpf ou caso_id; os campos em `valores` sobrepõem. Data de hoje já vem preenchida. Não invente dados: deixe vazio o que não souber. Concorde com o gênero da pessoa (nacionalidade \"brasileira\"/\"brasileiro\", \"solteira\", \"lavradora\"). Nomes em MAIÚSCULAS como no documento. Correspondências: localNascimento = naturalidade do RG; rgLocal = órgão expedidor/UF; rgDia/rgMes/rgAno = data de expedição; nascimentoDia/Mes/Ano = data de nascimento; municipio/uf/cep = do comprovante. Sem confirmação; o link vale 1 dia.\n\nModelos e campos (chave: rótulo; opções entre []):\n" +
        CATALOGO_MODELOS,
      parameters: {
        type: "object",
        properties: {
          modelo: {
            type: "string",
            enum: DOCUMENTOS_TEMPLATES.map((t) => t.slug),
            description: "Slug do modelo",
          },
          cpf: {
            type: "string",
            description: "CPF do cliente (puxa dados da ficha, se existir). Opcional.",
          },
          caso_id: { type: "number", description: "ID do caso no funil de vendas. Opcional." },
          valores: {
            type: "object",
            description:
              "Campos do modelo {chave: valor} extraídos dos documentos/conversa. Ex.: {\"nome\":\"MARIA DA SILVA\",\"rg\":\"012345678 SSP/MA\",\"endereco\":\"Rua X, 10, Centro, Bacabal/MA, CEP 65700-000\",\"estadoCivil\":\"solteira\",\"profissao\":\"lavradora\"}",
            additionalProperties: { type: "string" },
          },
        },
        required: ["modelo"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "verificar_processos_lote",
      description:
        "Use SEMPRE que o usuário colar 1 ou N processos (nº CNJ/NB/requerimento + CPF + nome) ou pedir 'cadastra o processo'. Verifica em lote (máx. 50) se cada CPF já tem cliente (nome, telefone) e se o nº já está cadastrado (processo_id, funil, coluna). CPF sem cliente = cliente novo, cadastrado junto pelo processo (sem telefone). Chame antes de cadastrar_processos_lote.",
      parameters: {
        type: "object",
        properties: {
          itens: {
            type: "array",
            description: "Itens extraídos da mensagem, na ordem colada.",
            items: {
              type: "object",
              properties: {
                numero_processo: {
                  type: "string",
                  description: "Nº CNJ, NB ou requerimento (com ou sem máscara/☐).",
                },
                cpf: { type: "string", description: "CPF do cliente" },
                nome: { type: "string", description: "Nome do cliente (opcional)" },
              },
              required: ["cpf"],
            },
          },
        },
        required: ["itens"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "listar_parceiros",
      description:
        "Lista os parceiros do escritório (id, nome, cidade) — 'parceiro' no pedido do usuário é SEMPRE um destes (não é sistema externo). Use o id em parceiro_id de cadastrar_processos_lote / criar_processo.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "listar_conversa_resumo",
      description:
        "Resumo das últimas mensagens WhatsApp de um contato (contact_norm ou telefone).",
      parameters: {
        type: "object",
        properties: {
          contact_norm: {
            type: "string",
            description: "Telefone / contact_norm do WhatsApp",
          },
          limite: {
            type: "number",
            description: "Quantidade de mensagens recentes (padrão 15, máx. 40)",
          },
        },
        required: ["contact_norm"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "resumo_atendimentos_hoje",
      description:
        "Resumo dos atendimentos/conversas WhatsApp com atividade HOJE (fuso America/Sao_Paulo): quantas conversas tiveram mensagem hoje + trecho/resumo por contato. Use quando pedirem 'atendimentos de hoje', 'o que rolou hoje', volume do dia, etc.",
      parameters: {
        type: "object",
        properties: {
          limite: {
            type: "number",
            description:
              "Máximo de conversas no retorno (padrão 25, máx. 40). Contagem total sempre inclui todas do dia.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ler_prompt_agente",
      description:
        "Lê o rascunho do agente WhatsApp: persona/regras E mensagem_abertura. Só advogado. Retorna metadados + índice de seções da persona + textos (salvo zoom). Sempre varra os dois documentos antes de propor alterações. Opcional: secao ou trecho para zoom. Não despeje tudo no chat — cite âncoras. Link: /configuracoes (aba Agente).",
      parameters: {
        type: "object",
        properties: {
          secao: {
            type: "string",
            description:
              "Nome de seção (heading markdown ou tag XML, ex.: IDENTIDADE, checklist-documentos) para zoom.",
          },
          trecho: {
            type: "string",
            description:
              "Substring para localizar e devolver contexto ao redor (zoom).",
          },
          incluir_texto_completo: {
            type: "boolean",
            description:
              "Se true, inclui persona completa em data (padrão false — use índice/zoom).",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ler_versoes_prompt_agente",
      description:
        "Lista versões recentes do prompt do agente WhatsApp (histórico de rascunhos e publicações). Só advogado. Retorna id, data, fonte, publicado, motivo e excerpt. Use antes de reverter_prompt_agente.",
      parameters: {
        type: "object",
        properties: {
          limite: {
            type: "number",
            description: "Máximo de versões (padrão 20, máx. 50).",
          },
        },
      },
    },
  },
  ...ASSISTENTE_WRITE_TOOL_DEFINITIONS,
] as const;

export type AssistenteToolName =
  (typeof ASSISTENTE_TOOL_DEFINITIONS)[number]["function"]["name"];

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Drops null/undefined/"" so tool payloads stay small. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function processosFunilHref(funil: FunilProcesso): string {
  return `/processos?funil=${funil}`;
}

function resumoProcesso(
  p: Tables<"processos_clientes">,
  colunas: Record<FunilProcesso, ProcessoColunaMatch[]> | null
) {
  const funil = normalizeAreaProcesso(p.area);
  return {
    ...compact({
      id: p.id,
      nome: p.nome,
      cpf: p.cpf,
      numero_processo: p.numero_processo,
      tribunal: p.tribunal,
      telefone: p.telefone,
      coluna: p.funil_coluna,
      coluna_nome: p.funil_coluna
        ? colunas
          ? labelDaColunaProcesso(p.funil_coluna, colunas[funil])
          : p.funil_coluna
        : null,
      polo_ativo: p.polo_ativo,
      polo_passivo: p.polo_passivo,
      tipo_acao: p.tipo_acao,
      vara_comarca: p.vara_comarca,
      valor:
        p.valor_centavos != null ? formatValorCentavos(p.valor_centavos) : null,
      processo_origem: p.processo_origem,
      situacao: p.situacao,
      situacao_nome: situacaoProcessoInfo(p.situacao)?.label ?? null,
      beneficio: funilTemBeneficio(funil) ? p.beneficio_identificado : null,
      ultimo_andamento_data: p.ultimo_andamento_data,
      ultimo_movimento: p.ultimo_movimento
        ? clipPreview(p.ultimo_movimento, 160)
        : null,
      observacao: p.observacao ? clipPreview(p.observacao, 160) : null,
      parceiro_id: p.parceiro_id,
    }),
    funil,
    href_funil: processosFunilHref(funil),
  };
}

function resumoAudiencia(
  p: Pick<
    Tables<"app_prazos">,
    | "id"
    | "titulo"
    | "data_prazo"
    | "hora_prazo"
    | "local"
    | "modalidade"
    | "link_audiencia"
    | "processo_id"
    | "cpf"
    | "concluido"
  >
) {
  return compact({
    id: p.id,
    titulo: p.titulo,
    data: p.data_prazo,
    hora: p.hora_prazo ? p.hora_prazo.slice(0, 5) : null,
    modalidade: p.modalidade,
    local: p.local,
    link: p.link_audiencia,
    processo_id: p.processo_id,
    cpf: p.cpf,
    concluido: p.concluido || null,
  });
}

async function toolBuscarPessoas(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const termo = str(args.termo);
  if (termo.length < 2) {
    return { ok: false, summary: "Informe um termo com pelo menos 2 caracteres." };
  }
  const resultados = await buscarGlobal(termo);

  type PessoaHit = {
    nome: string;
    cpf: string | null;
    telefone: string | null;
    href: string | null;
    fontes: string[];
  };

  const byKey = new Map<string, PessoaHit>();

  for (const r of resultados) {
    const cpf = r.cpf ? normalizeCpf(r.cpf) : null;
    const telefone = (r.telefone ?? "").trim() || null;
    // Prefer CPF as identity; else phone; else title+href (weak).
    const key = cpf
      ? `cpf:${cpf}`
      : telefone
        ? `tel:${telefone}`
        : `nome:${r.titulo.toLowerCase()}|${r.href}`;

    const existing = byKey.get(key);
    if (existing) {
      if (!existing.cpf && cpf) existing.cpf = cpf;
      if (!existing.telefone && telefone) existing.telefone = telefone;
      if (!existing.fontes.includes(r.tipo)) existing.fontes.push(r.tipo);
      // Prefer a longer / fuller name
      if (r.titulo.length > existing.nome.length) existing.nome = r.titulo;
      continue;
    }

    const href = assistenteFichaHref({
      cpf,
      contactNorm: telefone,
    });

    byKey.set(key, {
      nome: r.titulo,
      cpf,
      telefone,
      href: cpf || telefone ? href : r.href,
      fontes: [r.tipo],
    });
  }

  const pessoas = Array.from(byKey.values());
  const match_count = pessoas.length;

  if (match_count === 0) {
    return {
      ok: true,
      summary: `Nenhuma pessoa para "${termo}". Se o usuário trouxe nº de processo/NB + CPF, NÃO é criar_cliente_caso: siga verificar_processos_lote → cadastrar_processos_lote (cliente novo entra junto, sem telefone). Senão, ofereça criar_cliente_caso + salvar anexo (se houver) ou peça CPF/telefone/outra grafia.`,
      data: {
        termo,
        match_count: 0,
        pessoas: [],
        hint: "zero_matches",
        resultados,
      },
    };
  }

  const formatPessoa = (p: PessoaHit) => {
    const bits = [p.nome];
    if (p.cpf) bits.push(`CPF ${p.cpf}`);
    if (p.telefone) bits.push(`tel ${p.telefone}`);
    return bits.join(" · ");
  };

  if (match_count === 1) {
    const p = pessoas[0]!;
    return {
      ok: true,
      summary: `Única pessoa: ${formatPessoa(p)}. Confirme ("É ${p.nome}?") ou ofereça criar usuário novo — não exija CPF.`,
      links: p.href ? [{ label: p.nome, href: p.href }] : undefined,
      data: {
        termo,
        match_count: 1,
        pessoas,
        hint: "unique_match",
        resultados,
      },
    };
  }

  return {
    ok: true,
    summary: `${match_count} pessoas para "${termo}". Liste e peça qual: ${pessoas
      .slice(0, 8)
      .map(formatPessoa)
      .join(" | ")}.`,
    links: pessoas
      .filter((p) => p.href)
      .slice(0, 8)
      .map((p) => ({ label: p.nome, href: p.href! })),
    data: {
      termo,
      match_count,
      pessoas,
      hint: "multiple_matches",
      resultados,
    },
  };
}

async function toolObterFicha(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const cpfRaw = str(args.cpf);
  const contactRaw = str(args.contact_norm) || str(args.telefone);
  if (!cpfRaw && !contactRaw) {
    return {
      ok: false,
      summary: "Informe cpf e/ou contact_norm (telefone) para abrir a ficha.",
    };
  }

  const ficha = await loadFichaPessoa({
    cpf: cpfRaw || null,
    contactNorm: contactRaw || null,
  });

  if (!ficha) {
    return { ok: false, summary: "Ficha não encontrada." };
  }

  const href = assistenteFichaHref({
    cpf: ficha.cpf,
    contactNorm: ficha.contactNorm,
  });
  const arquivosHref = assistenteFichaArquivosHref({
    cpf: ficha.cpf,
    contactNorm: ficha.contactNorm,
  });

  const colunasProc = ficha.processos.length
    ? await listProcessoColunasTodas().catch(() => null)
    : null;

  const audiencias = ficha.prazos.filter((p) => p.tipo === "audiencia");
  const outrosPrazos = ficha.prazos.filter((p) => p.tipo !== "audiencia");

  const resumo = {
    cpf: ficha.cpf,
    contact_norm: ficha.contactNorm,
    href,
    arquivos_href: arquivosHref,
    processos: ficha.processos.map((p) => resumoProcesso(p, colunasProc)),
    casos: ficha.casos.map((c) => ({
      id: c.id,
      nome: c.nome,
      status: c.status,
      beneficio: c.beneficio_identificado,
      telefone: c.telefone,
      href: assistenteKanbanHref(c.id),
    })),
    prazos: outrosPrazos.map((p) => ({
      id: p.id,
      titulo: p.titulo,
      data_prazo: p.data_prazo,
      hora_prazo: p.hora_prazo,
      tipo: p.tipo,
      processo_id: p.processo_id,
      concluido: p.concluido,
    })),
    audiencias: audiencias.map(resumoAudiencia),
    mensagens_count: ficha.mensagens.length,
    documentos_count: ficha.documentos.length,
  };

  const nome =
    ficha.processos[0]?.nome ||
    ficha.casos[0]?.nome ||
    ficha.cpf ||
    ficha.contactNorm;

  const casoLinks = ficha.casos.slice(0, 5).map((c) => ({
    label: `Kanban #${c.id}`,
    href: assistenteKanbanHref(c.id),
  }));
  const funisLinks = Array.from(
    new Set(resumo.processos.map((p) => p.funil))
  ).map((f) => ({
    label: `Processos ${labelFunilProcesso(f)}`,
    href: processosFunilHref(f),
  }));
  if (audiencias.length) {
    funisLinks.push({ label: "Audiências", href: "/audiencias" });
  }

  return {
    ok: true,
    summary: `Ficha de ${nome}: ${resumo.casos.length} caso(s), ${resumo.processos.length} processo(s), ${resumo.prazos.length} prazo(s), ${resumo.audiencias.length} audiência(s), ${resumo.mensagens_count} mensagem(ns). Ficha: ${href}. Arquivos: ${arquivosHref}.`,
    links: [
      { label: "Abrir ficha", href },
      { label: "Pastas / arquivos", href: arquivosHref },
      ...casoLinks,
      ...funisLinks,
    ],
    data: resumo,
  };
}

async function toolListarCasos(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const supabase = await createClient();
  const limite = clamp(num(args.limite, 20), 1, 40);
  const cpf = str(args.cpf) ? normalizeCpf(str(args.cpf)) : "";
  const telefone = str(args.telefone);
  const status = str(args.status);

  let query = supabase
    .from("casos_novos")
    .select(
      "id, nome, cpf, telefone, status, beneficio_identificado, created_at, updated_at"
    )
    .order("updated_at", { ascending: false })
    .limit(limite);

  if (cpf) query = query.eq("cpf", cpf);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return { ok: false, summary: error.message };

  let rows = data ?? [];
  if (telefone) {
    const norm = phoneToContactNorm(telefone);
    rows = rows.filter((c) => phoneToContactNorm(c.telefone) === norm);
  }

  if (!rows.length) {
    return { ok: true, summary: "Nenhum caso encontrado com esses filtros.", data: [] };
  }

  return {
    ok: true,
    summary: `${rows.length} caso(s) encontrado(s). Inclua os links /kanban/{id} na resposta.`,
    links: rows.map((c) => ({
      label: c.nome ?? `Caso #${c.id}`,
      href: assistenteKanbanHref(c.id),
    })),
    data: rows.map((c) => ({
      ...c,
      href: assistenteKanbanHref(c.id),
      ficha_href: assistenteFichaHref({
        cpf: c.cpf,
        contactNorm: c.telefone,
      }),
    })),
  };
}

async function toolListarPrazos(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const supabase = await createClient();
  const limite = clamp(num(args.limite, 30), 1, 50);
  const apenasAbertos = bool(args.apenas_abertos, true);
  const cpf = str(args.cpf) ? normalizeCpf(str(args.cpf)) : "";
  const dias = args.dias != null ? clamp(num(args.dias, 7), 1, 365) : null;
  const tipo = str(args.tipo).toLowerCase();

  let query = supabase
    .from("app_prazos")
    .select(
      "id, titulo, tipo, data_prazo, hora_prazo, descricao, cpf, caso_id, processo_id, concluido, local, modalidade, link_audiencia"
    )
    .order("data_prazo", { ascending: true })
    .order("hora_prazo", { ascending: true, nullsFirst: false })
    .limit(limite);

  if (apenasAbertos) query = query.eq("concluido", false);
  if (cpf) query = query.eq("cpf", cpf);
  if (tipo) query = query.eq("tipo", tipo);
  if (dias != null) {
    const hoje = new Date();
    const fim = new Date(hoje.getTime() + dias * 24 * 60 * 60 * 1000);
    query = query
      .gte("data_prazo", hoje.toISOString().slice(0, 10))
      .lte("data_prazo", fim.toISOString().slice(0, 10));
  }

  const { data, error } = await query;
  if (error) return { ok: false, summary: error.message };

  const rows = data ?? [];
  const soAudiencias = tipo === "audiencia";
  const listaHref = soAudiencias ? "/audiencias" : "/prazos";
  if (!rows.length) {
    return {
      ok: true,
      summary: soAudiencias
        ? "Nenhuma audiência encontrada."
        : "Nenhum prazo encontrado.",
      links: [{ label: soAudiencias ? "Audiências" : "Prazos", href: listaHref }],
      data: [],
    };
  }

  const links = rows
    .map((p) => {
      if (p.cpf) {
        return {
          label: p.titulo,
          href: assistenteFichaHref({ cpf: normalizeCpf(p.cpf) }),
        };
      }
      if (p.caso_id) {
        return { label: p.titulo, href: assistenteKanbanHref(p.caso_id) };
      }
      return { label: p.titulo, href: listaHref };
    })
    .slice(0, 12);
  links.push({ label: soAudiencias ? "Audiências" : "Prazos", href: listaHref });

  const items = rows.map((p) =>
    p.tipo === "audiencia"
      ? { tipo: p.tipo, caso_id: p.caso_id ?? undefined, ...resumoAudiencia(p) }
      : compact({
          id: p.id,
          titulo: p.titulo,
          tipo: p.tipo,
          data: p.data_prazo,
          hora: p.hora_prazo ? p.hora_prazo.slice(0, 5) : null,
          descricao: p.descricao ? clipPreview(p.descricao, 160) : null,
          cpf: p.cpf,
          caso_id: p.caso_id,
          processo_id: p.processo_id,
          concluido: p.concluido || null,
        })
  );

  return {
    ok: true,
    summary: `${rows.length} ${soAudiencias ? "audiência(s)" : "prazo(s)"} encontrado(s). Lista: ${listaHref}.`,
    links,
    data: items,
  };
}

function sanitizeOrTerm(raw: string): string {
  return raw.replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim();
}

async function toolListarProcessos(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const supabase = await createClient();
  const limite = clamp(num(args.limite, 20), 1, 50);
  const funilRaw = str(args.funil).toLowerCase();
  const funil: FunilProcesso | null = isFunilProcesso(funilRaw)
    ? funilRaw
    : funilRaw
      ? normalizeAreaProcesso(funilRaw)
      : null;
  const coluna = str(args.coluna);
  const situacao = str(args.situacao);
  const parceiroId = str(args.parceiro_id);
  const texto = sanitizeOrTerm(str(args.texto));

  let query = supabase
    .from("processos_clientes")
    .select("*")
    .order("ultimo_andamento_data", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(limite);

  if (funil === FUNIL_PROCESSO_PADRAO) {
    query = query.or(`area.eq.${funil},area.is.null`);
  } else if (funil) {
    query = query.eq("area", funil);
  }
  if (coluna) query = query.eq("funil_coluna", coluna);
  if (situacao) query = query.eq("situacao", situacao);
  if (parceiroId) query = query.eq("parceiro_id", parceiroId);
  if (texto) {
    const digits = texto.replace(/\D/g, "");
    const ors = [`nome.ilike.%${texto}%`, `numero_processo.ilike.%${texto}%`];
    if (digits.length >= 3) {
      ors.push(`cpf.ilike.%${digits}%`);
      if (digits !== texto) ors.push(`numero_processo.ilike.%${digits}%`);
    }
    query = query.or(ors.join(","));
  }

  const [{ data, error }, colunas] = await Promise.all([
    query,
    listProcessoColunasTodas().catch(() => null),
  ]);
  if (error) return { ok: false, summary: error.message };

  const rows = data ?? [];
  const funisHref = funil
    ? [{ label: `Processos ${labelFunilProcesso(funil)}`, href: processosFunilHref(funil) }]
    : [];

  if (!rows.length) {
    return {
      ok: true,
      summary: "Nenhum processo encontrado com esses filtros.",
      links: funisHref,
      data: [],
    };
  }

  const items = rows.map((p) => {
    const r = resumoProcesso(p, colunas);
    return {
      ...r,
      ficha_href: assistenteFichaHref({ cpf: p.cpf, contactNorm: p.telefone }),
    };
  });

  const preview = items
    .slice(0, 8)
    .map(
      (p) =>
        `#${p.id} ${p.nome ?? "?"} ${p.numero_processo ?? ""} [${labelFunilProcesso(p.funil)}${p.coluna_nome ? ` · ${p.coluna_nome}` : ""}${p.situacao_nome ? ` · ${p.situacao_nome}` : ""}]`
    )
    .join(" | ");

  return {
    ok: true,
    summary: `${rows.length} processo(s)${rows.length === limite ? " (limite atingido; refine filtros)" : ""}. ${preview}${rows.length > 8 ? "…" : ""}`,
    links: [
      ...items.slice(0, 8).map((p) => ({
        label: p.nome ?? `Processo #${p.id}`,
        href: p.ficha_href,
      })),
      ...funisHref,
    ],
    data: items,
  };
}

async function toolListarColunasFunis(): Promise<AssistenteToolResult> {
  const [vendas, processos] = await Promise.all([
    listKanbanColunas(),
    listProcessoColunasTodas(),
  ]);
  const fmt = (cols: { chave: string; label: string }[]) =>
    cols.map((c) => ({ chave: c.chave, nome: c.label }));
  const line = (cols: { chave: string; label: string }[]) =>
    cols.map((c) => `${c.chave}=${c.label}`).join(", ");

  const funisLine = FUNIS_PROCESSO.map(
    (f) => `Processos ${f.label} (funil=${f.value}): ${line(processos[f.value])}`
  ).join(". ");

  return {
    ok: true,
    summary: `Funil de vendas (casos): ${line(vendas)}. ${funisLine}. Situações de processo: ${SITUACOES_PROCESSO.map((s) => `${s.value}=${s.label}`).join(", ")}.`,
    data: {
      funil_vendas: fmt(vendas),
      ...Object.fromEntries(
        FUNIS_PROCESSO.map((f) => [`processos_${f.value}`, fmt(processos[f.value])])
      ),
      situacoes_processo: SITUACOES_PROCESSO.map((s) => ({
        chave: s.value,
        nome: s.label,
      })),
    },
  };
}

const LOTE_MAX_ITENS = 50;

/** CNJ segment 4 = Justiça Federal → judicial previdenciário; non-CNJ = NB/requerimento. */
function sugestaoFunilPorNumero(digits: string): FunilProcesso | null {
  if (!digits) return null;
  if (digits.length === 20) return digits[13] === "4" ? "previdenciario" : null;
  return "administrativo";
}

async function toolVerificarProcessosLote(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const rawItens = Array.isArray(args.itens) ? args.itens : [];
  if (!rawItens.length) {
    return { ok: false, summary: "Informe itens[] com cpf (e numero_processo)." };
  }
  if (rawItens.length > LOTE_MAX_ITENS) {
    return {
      ok: false,
      summary: `Máximo de ${LOTE_MAX_ITENS} itens por verificação; divida a lista.`,
    };
  }

  const itens = rawItens.map((raw, i) => {
    const r = asRecord(raw);
    const numeroRaw = str(r.numero_processo).replace(/[☐☑✓✔]/g, "").trim();
    const numeroDigits = normalizeNumeroProcesso(numeroRaw);
    const cpf = normalizeCpf(str(r.cpf));
    return {
      indice: i + 1,
      nome_informado: str(r.nome) || null,
      numeroRaw,
      numeroDigits,
      cpf,
    };
  });

  const numeroVariants = Array.from(
    new Set(
      itens.flatMap((it) =>
        it.numeroDigits
          ? [it.numeroDigits, formatNumeroProcesso(it.numeroDigits), it.numeroRaw]
          : []
      )
    )
  ).filter(Boolean);
  const cpfs = Array.from(new Set(itens.map((it) => it.cpf).filter((c) => c.length === 11)));
  const cpfVariants = Array.from(new Set(cpfs.flatMap((c) => [c, formatCpf(c)])));

  const supabase = await createClient();
  const procCols =
    "id, nome, cpf, telefone, numero_processo, area, funil_coluna, parceiro_id";
  const [porNumero, porCpf, casos, colunas] = await Promise.all([
    numeroVariants.length
      ? supabase.from("processos_clientes").select(procCols).in("numero_processo", numeroVariants)
      : Promise.resolve({ data: [], error: null }),
    cpfVariants.length
      ? supabase.from("processos_clientes").select(procCols).in("cpf", cpfVariants)
      : Promise.resolve({ data: [], error: null }),
    cpfVariants.length
      ? supabase
          .from("casos_novos")
          .select("id, nome, cpf, telefone, updated_at")
          .in("cpf", cpfVariants)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    listProcessoColunasTodas().catch(() => null),
  ]);
  const err = porNumero.error || porCpf.error || casos.error;
  if (err) return { ok: false, summary: err.message };

  type ProcRow = Pick<
    Tables<"processos_clientes">,
    "id" | "nome" | "cpf" | "telefone" | "numero_processo" | "area" | "funil_coluna" | "parceiro_id"
  >;
  const procByNumero = new Map<string, ProcRow>();
  for (const p of (porNumero.data ?? []) as ProcRow[]) {
    const k = normalizeNumeroProcesso(p.numero_processo ?? "");
    if (k && !procByNumero.has(k)) procByNumero.set(k, p);
  }

  type Cliente = { nome: string; telefone: string | null; fontes: Set<string>; processos: number };
  const clienteByCpf = new Map<string, Cliente>();
  const touch = (cpfRaw: string | null, nome: string | null, telefone: string | null, fonte: string) => {
    const cpf = cpfRaw ? normalizeCpf(cpfRaw) : "";
    if (!cpf) return null;
    let c = clienteByCpf.get(cpf);
    if (!c) {
      c = { nome: nome?.trim() || "", telefone: null, fontes: new Set(), processos: 0 };
      clienteByCpf.set(cpf, c);
    }
    if (!c.nome && nome?.trim()) c.nome = nome.trim();
    if (!c.telefone && telefone?.trim()) c.telefone = telefone.trim();
    c.fontes.add(fonte);
    return c;
  };
  for (const c of casos.data ?? []) touch(c.cpf, c.nome, c.telefone, "caso");
  for (const p of (porCpf.data ?? []) as ProcRow[]) {
    const c = touch(p.cpf, p.nome, p.telefone, "processo");
    if (c) c.processos += 1;
  }

  const resultado = itens.map((it) => {
    const cpfValido = isValidCpf(it.cpf);
    const cliente = it.cpf ? clienteByCpf.get(it.cpf) : undefined;
    const proc = it.numeroDigits ? procByNumero.get(it.numeroDigits) : undefined;
    const procFunil = proc ? normalizeAreaProcesso(proc.area) : null;
    const procCpf = proc ? normalizeCpf(proc.cpf) : null;
    return {
      indice: it.indice,
      numero_processo: it.numeroDigits ? formatNumeroProcesso(it.numeroDigits) : null,
      numero_cnj_valido: it.numeroDigits ? isValidNumeroProcesso(it.numeroDigits) : false,
      cpf: it.cpf ? formatCpf(it.cpf) : null,
      cpf_valido: cpfValido,
      nome_informado: it.nome_informado,
      sugestao_funil: sugestaoFunilPorNumero(it.numeroDigits),
      cliente_existente: cliente
        ? {
            nome: cliente.nome || null,
            telefone: cliente.telefone,
            fontes: Array.from(cliente.fontes),
            processos_no_cpf: cliente.processos,
            ficha_href: assistenteFichaHref({ cpf: it.cpf }),
          }
        : null,
      cliente_novo: cpfValido && !cliente,
      processo_existente:
        proc && procFunil
          ? {
              processo_id: proc.id,
              nome: proc.nome,
              area: procFunil,
              funil_nome: labelFunilProcesso(procFunil),
              funil_coluna: proc.funil_coluna,
              coluna_nome: proc.funil_coluna
                ? colunas
                  ? labelDaColunaProcesso(proc.funil_coluna, colunas[procFunil])
                  : proc.funil_coluna
                : null,
              parceiro_id: proc.parceiro_id,
              cpf_diferente: Boolean(procCpf && it.cpf && procCpf !== it.cpf),
              href_funil: processosFunilHref(procFunil),
            }
          : null,
    };
  });

  const novos = resultado.filter((r) => !r.processo_existente);
  const existentes = resultado.filter((r) => r.processo_existente);
  const clientesNovos = resultado.filter((r) => r.cliente_novo).length;
  const clientesExistentes = resultado.filter((r) => r.cliente_existente).length;
  const cpfInvalidos = resultado.filter((r) => !r.cpf_valido);
  const semNumero = resultado.filter((r) => !r.numero_processo);

  const parts = [
    `${resultado.length} item(ns): ${novos.length} processo(s) novo(s), ${existentes.length} já cadastrado(s).`,
    `${clientesExistentes} cliente(s) já existente(s) (vincular pelo CPF sem perguntar), ${clientesNovos} cliente(s) novo(s) (cadastrados junto com o processo, sem telefone).`,
  ];
  if (existentes.length) {
    parts.push(
      `Já cadastrados (pergunte atualizar ou ignorar): ${existentes
        .map(
          (r) =>
            `#${r.indice} ${r.numero_processo} → processo_id ${r.processo_existente!.processo_id} [${r.processo_existente!.funil_nome}${r.processo_existente!.coluna_nome ? ` · ${r.processo_existente!.coluna_nome}` : ""}]${r.processo_existente!.cpf_diferente ? " (CPF diferente!)" : ""}`
        )
        .join(" | ")}.`
    );
  }
  if (cpfInvalidos.length) {
    parts.push(`CPF inválido nos itens: ${cpfInvalidos.map((r) => `#${r.indice}`).join(", ")} — peça o CPF correto.`);
  }
  if (semNumero.length) {
    parts.push(
      `Sem nº de processo: ${semNumero.map((r) => `#${r.indice}`).join(", ")} — podem ser cadastrados assim (ficam como "sem número" e o número é adicionado depois); confirme com o usuário.`
    );
  }
  parts.push("Próximo passo: perguntar só o que falta (funil, coluna, parceiro, duplicados) e propor cadastrar_processos_lote.");

  return {
    ok: true,
    summary: parts.join(" "),
    data: { itens: resultado },
  };
}

async function toolListarParceiros(): Promise<AssistenteToolResult> {
  const parceiros = await listParceiros();
  if (!parceiros.length) {
    return {
      ok: true,
      summary:
        "Nenhum parceiro cadastrado. Avise o usuário e aponte para Configurações → Parceiros; o processo pode ser cadastrado sem parceiro.",
      links: [{ label: "Configurações → Parceiros", href: "/configuracoes" }],
      data: { parceiros: [] },
    };
  }
  const items = parceiros.map((p) => compact({ id: p.id, nome: p.nome, cidade: p.cidade }));
  return {
    ok: true,
    summary: `${items.length} parceiro(s): ${parceiros
      .map((p) => `${p.nome}${p.cidade ? ` (${p.cidade})` : ""} = ${p.id}`)
      .join(" | ")}. ${items.length === 1 ? "Só um: sugira este." : "Se o usuário não citou nome, pergunte qual."}`,
    data: { parceiros: items },
  };
}

async function toolListarConversaResumo(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const raw = str(args.contact_norm) || str(args.telefone);
  if (!raw) {
    return { ok: false, summary: "Informe contact_norm ou telefone." };
  }
  const contact = phoneToContactNorm(raw);
  const limite = clamp(num(args.limite, 15), 1, 40);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mensagens")
    .select("id, type, text, created_at, phone, contact_norm")
    .eq("contact_norm", contact)
    .order("created_at", { ascending: false })
    .limit(limite);

  if (error) return { ok: false, summary: error.message };

  const rows = [...(data ?? [])].reverse();
  const atendimentoHref = assistenteAtendimentoHref(contact);
  if (!rows.length) {
    return {
      ok: true,
      summary: `Nenhuma mensagem para ${contact}.`,
      links: [{ label: "Abrir atendimento", href: atendimentoHref }],
      data: [],
    };
  }

  const resumo = rows.map((m) => ({
    tipo: m.type,
    created_at: m.created_at,
    trecho: (m.text ?? "").slice(0, 280),
  }));

  return {
    ok: true,
    summary: `${rows.length} mensagem(ns) recentes de ${contact}. Atendimento: ${atendimentoHref}.`,
    links: [{ label: "Abrir atendimento", href: atendimentoHref }],
    data: resumo,
  };
}

async function toolResumoAtendimentosHoje(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const limite = clamp(num(args.limite, 25), 1, 40);
  const { day, startIso, endIso } = brazilCalendarDayBounds();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mensagens")
    .select("id, type, text, created_at, phone, contact_norm")
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .order("created_at", { ascending: false })
    .limit(800);

  if (error) return { ok: false, summary: error.message };

  type Msg = {
    id: number;
    type: string | null;
    text: string | null;
    created_at: string;
    phone: string | null;
    contact_norm: string | null;
  };

  const byContact = new Map<
    string,
    {
      contact_norm: string;
      msgs: Msg[];
      last_at: string;
    }
  >();

  for (const raw of data ?? []) {
    const m = raw as Msg;
    const contact =
      phoneToContactNorm(m.contact_norm || m.phone || "") || "";
    if (!contact) continue;
    const bucket = byContact.get(contact);
    if (bucket) {
      if (bucket.msgs.length < 6) bucket.msgs.push(m);
      continue;
    }
    byContact.set(contact, {
      contact_norm: contact,
      msgs: [m],
      last_at: m.created_at,
    });
  }

  const conversasCount = byContact.size;
  if (conversasCount === 0) {
    return {
      ok: true,
      summary: `Nenhum atendimento com mensagem hoje (${day}, America/Sao_Paulo).`,
      data: { day, conversas_count: 0, conversas: [] },
    };
  }

  const sorted = Array.from(byContact.values()).sort((a, b) =>
    b.last_at.localeCompare(a.last_at)
  );

  const contacts = sorted.map((c) => c.contact_norm);
  const { data: casos } = await supabase
    .from("casos_novos")
    .select("id, nome, cpf, telefone, status")
    .order("updated_at", { ascending: false })
    .limit(200);

  const nomeByContact = new Map<string, { nome: string; cpf: string | null; caso_id: number | null }>();
  for (const c of casos ?? []) {
    const norm = phoneToContactNorm(c.telefone);
    if (!norm || !contacts.includes(norm)) continue;
    if (nomeByContact.has(norm)) continue;
    nomeByContact.set(norm, {
      nome: c.nome?.trim() || norm,
      cpf: c.cpf ? normalizeCpf(c.cpf) : null,
      caso_id: c.id,
    });
  }

  const conversas = sorted.slice(0, limite).map((c) => {
    const meta = nomeByContact.get(c.contact_norm);
    const chronological = [...c.msgs].reverse();
    const trechos = chronological
      .map((m) => {
        const t = (m.text ?? "").replace(/\s+/g, " ").trim();
        if (!t) return `(${m.type || "mídia"})`;
        return t.slice(0, 120);
      })
      .filter(Boolean);
    const snippet = trechos.slice(-3).join(" · ");
    const ficha = assistenteFichaHref({
      cpf: meta?.cpf,
      contactNorm: c.contact_norm,
    });
    return {
      contact_norm: c.contact_norm,
      nome: meta?.nome ?? null,
      caso_id: meta?.caso_id ?? null,
      mensagens_hoje_amostra: c.msgs.length,
      last_at: c.last_at,
      resumo: snippet || "(sem texto)",
      href_atendimento: assistenteAtendimentoHref(c.contact_norm),
      href_ficha: ficha,
      href_kanban: meta?.caso_id
        ? assistenteKanbanHref(meta.caso_id)
        : null,
    };
  });

  const preview = conversas
    .slice(0, 8)
    .map((c) => `${c.nome || c.contact_norm}: ${c.resumo}`)
    .join(" | ");

  return {
    ok: true,
    summary: `${conversasCount} conversa(s) com atividade hoje (${day}). Amostra: ${preview}`,
    links: conversas.slice(0, 12).flatMap((c) => {
      const links = [
        {
          label: c.nome || c.contact_norm,
          href: c.href_atendimento,
        },
      ];
      if (c.href_kanban) {
        links.push({
          label: `Kanban ${c.nome || c.contact_norm}`,
          href: c.href_kanban,
        });
      }
      return links;
    }),
    data: {
      day,
      timezone: "America/Sao_Paulo",
      conversas_count: conversasCount,
      conversas,
    },
  };
}

async function toolLerPromptAgente(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  let user;
  try {
    user = await getAppUser();
  } catch {
    return { ok: false, summary: "Não autenticado." };
  }
  if (!user) {
    return { ok: false, summary: "Não autenticado." };
  }
  if (user.papel !== "advogado") {
    return {
      ok: false,
      summary:
        "Só advogado pode ler o prompt do agente. Explique ao usuário que essa alteração é restrita ao papel advogado.",
    };
  }

  let config;
  try {
    config = await getAgenteConfig();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao ler config do agente";
    return { ok: false, summary: msg };
  }
  if (!config) {
    return { ok: false, summary: "Configuração do agente não encontrada." };
  }

  const persona = config.persona ?? "";
  const mensagem_abertura = config.mensagem_abertura ?? "";
  const rascunhoDiferente =
    persona.trim() !== (config.persona_publicada ?? "").trim() ||
    mensagem_abertura.trim() !==
      (config.mensagem_abertura_publicada ?? "").trim();
  const secoes = indexPromptSections(persona);
  const secaoNome = str(args.secao);
  const trecho = str(args.trecho);
  const incluirCompleto = bool(args.incluir_texto_completo, false);

  let zoom: {
    tipo: "secao" | "trecho";
    name?: string;
    line?: number;
    matches?: number;
    documento?: "persona" | "mensagem_abertura";
    content: string;
  } | null = null;

  if (secaoNome) {
    const found = extractPromptSection(persona, secaoNome);
    if (!found) {
      return {
        ok: false,
        summary: `Seção "${secaoNome}" não encontrada. Seções: ${secoes
          .slice(0, 20)
          .map((s) => s.name)
          .join(", ")}${secoes.length > 20 ? "…" : ""}.`,
        data: { secoes },
        links: [{ label: "Configurações → Agente", href: "/configuracoes" }],
      };
    }
    zoom = {
      tipo: "secao",
      name: found.name,
      line: found.line,
      documento: "persona",
      content: found.content,
    };
  } else if (trecho) {
    const ctxPersona = extractTrechoContext(persona, trecho);
    const ctxAbertura = extractTrechoContext(mensagem_abertura, trecho);
    if (!ctxPersona.preview && !ctxAbertura.preview) {
      return {
        ok: false,
        summary: `Trecho não encontrado na persona nem na mensagem de abertura. Use o índice de seções ou outro fragmento.`,
        data: { secoes, versao: config.versao },
        links: [{ label: "Configurações → Agente", href: "/configuracoes" }],
      };
    }
    // Prefer persona hit; mention abertura matches in summary via data.
    if (ctxPersona.preview) {
      zoom = {
        tipo: "trecho",
        matches: ctxPersona.matches,
        documento: "persona",
        content: ctxPersona.preview,
      };
    } else {
      zoom = {
        tipo: "trecho",
        matches: ctxAbertura.matches,
        documento: "mensagem_abertura",
        content: ctxAbertura.preview!,
      };
    }
  }

  const secoesPreview = secoes
    .slice(0, 24)
    .map((s) => `L${s.line} [${s.kind}] ${s.name}`)
    .join(" | ");

  const summaryParts = [
    `Prompt agente v${config.versao}`,
    `persona ${persona.length} chars`,
    `abertura ${mensagem_abertura.length} chars`,
    rascunhoDiferente ? "rascunho ≠ publicado" : "rascunho = publicado",
    config.published_at
      ? `publicado ${config.published_at.slice(0, 10)}`
      : "nunca publicado",
    `${secoes.length} seção(ões)`,
  ];
  if (zoom?.tipo === "secao") {
    summaryParts.push(`zoom seção ${zoom.name} @L${zoom.line}`);
  } else if (zoom?.tipo === "trecho") {
    summaryParts.push(
      `zoom trecho em ${zoom.documento ?? "persona"} (${zoom.matches ?? 0} ocorrência(s))`
    );
  }

  return {
    ok: true,
    summary: `${summaryParts.join(" · ")}. Índice: ${secoesPreview || "(vazio)"}. Não cole o prompt inteiro no chat — varra persona E mensagem_abertura antes de propor.`,
    links: [{ label: "Configurações → Agente", href: "/configuracoes" }],
    data: {
      versao: config.versao,
      published_at: config.published_at,
      updated_at: config.updated_at,
      rascunho_diferente_do_publicado: rascunhoDiferente,
      tamanho_chars: persona.length,
      abertura_chars: mensagem_abertura.length,
      secoes,
      zoom,
      // Full drafts when no zoom (or explicitly requested); zoom alone when focused.
      ...(incluirCompleto || !zoom
        ? { persona, mensagem_abertura }
        : {}),
      href: "/configuracoes",
    },
  };
}

async function toolLerVersoesPromptAgente(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  let user;
  try {
    user = await getAppUser();
  } catch {
    return { ok: false, summary: "Não autenticado." };
  }
  if (!user) {
    return { ok: false, summary: "Não autenticado." };
  }
  if (user.papel !== "advogado") {
    return {
      ok: false,
      summary:
        "Só advogado pode ler o histórico do prompt do agente. Explique ao usuário que essa consulta é restrita ao papel advogado.",
    };
  }

  const limite = num(args.limite, 20);

  let versoes;
  try {
    versoes = await listAgenteConfigVersoes({ limite });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao listar versões";
    return { ok: false, summary: msg };
  }

  const items = versoes.map((v) => ({
    id: v.id,
    created_at: v.created_at,
    publicado: v.publicado,
    fonte: v.fonte,
    motivo: v.motivo,
    config_versao: v.config_versao,
    excerpt: clipPreview(v.persona, 140),
    abertura_excerpt: clipPreview(v.mensagem_abertura, 80),
    persona_chars: v.persona.length,
  }));

  const listPreview = items
    .slice(0, 8)
    .map(
      (v) =>
        `${v.id.slice(0, 8)}… ${v.created_at.slice(0, 16)} [${v.publicado ? "pub" : "rasc"}/${v.fonte}] ${v.excerpt}`
    )
    .join(" | ");

  return {
    ok: true,
    summary:
      items.length === 0
        ? "Nenhuma versão no histórico ainda. Versões aparecem ao salvar rascunho ou publicar."
        : `${items.length} versão(ões) recentes. ${listPreview}${items.length > 8 ? "…" : ""}. Para restaurar: reverter_prompt_agente com versao_id (só rascunho; não publica).`,
    links: [{ label: "Configurações → Agente", href: "/configuracoes" }],
    data: { versoes: items, total: items.length },
  };
}

async function toolPreencherDocumento(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const slug = typeof args.modelo === "string" ? args.modelo.trim() : "";
  const template = getDocumentoTemplate(slug);
  if (!template) {
    return {
      ok: false,
      summary: `Modelo inválido. Use: ${DOCUMENTOS_TEMPLATES.map((t) => t.slug).join(", ")}`,
    };
  }
  const cpfArg = typeof args.cpf === "string" ? normalizeCpf(args.cpf) : "";
  const casoId =
    typeof args.caso_id === "number" && args.caso_id > 0 ? Math.trunc(args.caso_id) : null;
  const informados =
    args.valores && typeof args.valores === "object" && !Array.isArray(args.valores)
      ? (args.valores as Record<string, unknown>)
      : {};

  // Cliente não cadastrado → só os valores informados (não é erro).
  const dados =
    (await carregarDadosDocumento({ casoId, cpf: cpfArg || null })) ??
    (await carregarDadosDocumento({}));
  if (!dados) return { ok: false, summary: "Não consegui carregar os dados base do documento." };

  const { valores, faltando, ignorados } = montarValoresDocumento(template, dados, informados);
  const nome = valores.nome || valores.beneficiario1Nome || dados.clienteNome || "";
  const cpf = normalizeCpf(valores.cpf || valores.beneficiario1Cpf || dados.clienteCpf || "");
  const { id } = await criarDocumentoGerado({
    modelo: template.slug,
    valores,
    clienteNome: nome || null,
    clienteCpf: cpf.length === 11 ? cpf : null,
  });

  const partes = [
    `${template.label} preenchido${nome ? ` para ${nome}` : ""}. Link válido por ${VALIDADE_DOCUMENTO_HORAS}h.`,
    faltando.length
      ? `Campos em branco (preencher à mão ou peça os dados e chame de novo): ${faltando.join(", ")}.`
      : "Todos os campos preenchidos.",
    ignorados.length ? `Ignorados (chave/opção inválida): ${ignorados.join(", ")}.` : "",
    'Os botões "Abrir PDF preenchido" e "Revisar no editor" aparecem abaixo da resposta — NÃO escreva as URLs. Lembre que o documento precisa ser assinado pelo cliente.',
  ];
  return {
    ok: true,
    summary: partes.filter(Boolean).join(" "),
    links: [
      { label: "Abrir PDF preenchido", href: documentoGeradoHref(id) },
      { label: "Revisar no editor", href: documentoGeradoEditorHref(template.slug, id) },
    ],
    data: { id, modelo: template.slug, faltando, valores },
  };
}

async function toolGerarRelatorioProcessos(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const funilArg = typeof args.funil === "string" ? args.funil.trim() : "";
  const colunaArg = typeof args.coluna === "string" ? args.coluna.trim() : "";
  const funil = funilArg && funilArg !== "todos" ? normalizeFunilArg(funilArg) : "todos";
  try {
    const dados = await carregarRelatorioProcessos({
      funil,
      coluna: colunaArg || null,
    });
    const href = relatorioProcessosHref({ funil, coluna: colunaArg || null });
    const porColuna = dados.funis
      .map((f) => {
        const cols = f.colunas
          .map((c) => `${c.label}: ${c.processos.length}`)
          .join("; ");
        return `${f.label} — ${cols}`;
      })
      .join(" | ");
    const escopo =
      dados.escopo.funil === "todos"
        ? "todos os funis"
        : colunaArg
          ? `${dados.funis[0].label} → ${dados.funis[0].colunas[0]?.label ?? colunaArg}`
          : `${dados.funis[0].label} (todas as colunas)`;
    return {
      ok: true,
      summary: `Relatório PDF pronto (${escopo}): ${dados.total} processo(s). ${porColuna}. O botão "Abrir relatório PDF" já aparece abaixo da resposta — NÃO escreva a URL nem link em markdown.`,
      links: [{ label: "Abrir relatório PDF", href }],
      data: { href, total: dados.total, escopo },
    };
  } catch (e) {
    if (e instanceof RelatorioParamError) return { ok: false, summary: e.message };
    throw e;
  }
}

/** Aceita chave ou nome ("judicial", "cível", "concedidos"...). */
function normalizeFunilArg(raw: string): string {
  if (isFunilProcesso(raw)) return raw;
  const a = raw.toLowerCase();
  if (a.includes("judic")) return "previdenciario";
  return isFunilProcesso(a) ? a : normalizeAreaProcesso(a);
}

/**
 * Executes a tool. Write tools always propose (UI confirm) —
 * use executeAssistenteWriteTool after the user confirms.
 */
export async function executeAssistenteTool(
  name: string,
  rawArgs: unknown,
  opts?: { pendingAnexo?: AssistentePendingAnexo | null }
): Promise<AssistenteToolResult> {
  const args = asRecord(rawArgs);
  try {
    if (isWriteTool(name)) {
      return await proposeAssistenteWriteTool(name, args, {
        pendingAnexo: opts?.pendingAnexo,
      });
    }
    switch (name) {
      case "buscar_pessoas":
        return await toolBuscarPessoas(args);
      case "obter_ficha":
        return await toolObterFicha(args);
      case "listar_casos":
        return await toolListarCasos(args);
      case "listar_prazos":
        return await toolListarPrazos(args);
      case "listar_processos":
        return await toolListarProcessos(args);
      case "listar_colunas_funis":
        return await toolListarColunasFunis();
      case "preencher_documento":
        return await toolPreencherDocumento(args);
      case "gerar_relatorio_processos":
        return await toolGerarRelatorioProcessos(args);
      case "verificar_processos_lote":
        return await toolVerificarProcessosLote(args);
      case "listar_parceiros":
        return await toolListarParceiros();
      case "listar_conversa_resumo":
        return await toolListarConversaResumo(args);
      case "resumo_atendimentos_hoje":
        return await toolResumoAtendimentosHoje(args);
      case "ler_prompt_agente":
        return await toolLerPromptAgente(args);
      case "ler_versoes_prompt_agente":
        return await toolLerVersoesPromptAgente(args);
      default:
        return { ok: false, summary: `Ferramenta desconhecida: ${name}` };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao executar ferramenta";
    return { ok: false, summary: msg };
  }
}
