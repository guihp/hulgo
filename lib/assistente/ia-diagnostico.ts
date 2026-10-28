import "server-only";

import { atualizarTipoCaso, criarTipoCaso } from "@/lib/actions/tipos-caso";
import { getAppUser } from "@/lib/actions/auth";
import { assistenteAtendimentoHref } from "@/lib/assistente/links";
import type { AssistenteToolResult } from "@/lib/assistente/types";
import { listTiposCaso, matchTipoCaso, type TipoCasoMatch } from "@/lib/data/tipos-caso";
import { createServiceClient } from "@/lib/supabase/service";
import { phoneToContactNorm } from "@/lib/utils/phone";

/*
 * Assistente × IA do WhatsApp: ler os tipos de caso, entender por que a IA
 * respondeu de um jeito (conversa + o que ela consultou em cada turno) e
 * propor ajuste no tipo de caso. Ajuste no prompt usa propor_alteracao_prompt_agente.
 */

export const IA_DIAGNOSTICO_READ_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "ler_tipos_caso",
      description:
        "Lê os tipos de caso cadastrados em Configurações → Tipos de caso: nome, apelidos, documentos pedidos (na ordem) e 'o que a IA precisa saber' (requisitos, perguntas, cuidados). É daqui que a IA do WhatsApp tira a lista de documentos de cada benefício. Opcional: beneficio (texto) devolve só o tipo que a IA usaria para esse benefício.",
      parameters: {
        type: "object",
        properties: {
          beneficio: {
            type: "string",
            description: "Benefício/demanda (ex.: BPC, auxílio-doença). Vazio = todos os tipos.",
          },
          incluir_inativos: { type: "boolean", description: "Inclui tipos desativados." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "diagnosticar_atendimento_ia",
      description:
        "Mostra como a IA do WhatsApp conduziu a conversa com um contato: mensagens recentes marcando quem falou (cliente, IA ou equipe) e, para cada resposta da IA, o que ela recebeu, quais ferramentas chamou (com o que voltou — ex.: checklist_beneficios com os documentos do tipo de caso) e qual versão do prompt usou. Use quando o usuário não gostar de uma resposta da IA ou perguntar por que ela fez algo. Só advogado.",
      parameters: {
        type: "object",
        properties: {
          contact_norm: { type: "string", description: "Telefone / contact_norm do cliente." },
          mensagens: {
            type: "number",
            description: "Quantas mensagens recentes (padrão 30, máx. 60).",
          },
          execucoes: {
            type: "number",
            description: "Quantas respostas recentes da IA detalhar (padrão 6, máx. 15).",
          },
        },
        required: ["contact_norm"],
      },
    },
  },
] as const;

export const PROPOR_TIPO_CASO_DEFINITION = {
  type: "function" as const,
  function: {
    name: "propor_alteracao_tipo_caso",
    description:
      "Propõe ajuste num tipo de caso (Configurações → Tipos de caso) — card Confirmar; só advogado. Use quando a causa de uma resposta ruim da IA do WhatsApp for documento faltando/sobrando na lista, apelido que não reconheceu o benefício, ou falta de orientação (requisito, pergunta, cuidado). Antes: ler_tipos_caso. Pode criar um tipo novo com novo_tipo_nome. Vale na hora para a IA (não precisa publicar).",
    parameters: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          description: "Chave, nome ou id do tipo existente (de ler_tipos_caso).",
        },
        novo_tipo_nome: {
          type: "string",
          description: "Só para criar um tipo novo (aí não informe tipo).",
        },
        documentos_adicionar: {
          type: "array",
          items: { type: "string" },
          description: "Documentos a acrescentar no fim da lista.",
        },
        documentos_remover: {
          type: "array",
          items: { type: "string" },
          description: "Documentos a tirar (texto igual ao da lista).",
        },
        documentos: {
          type: "array",
          items: { type: "string" },
          description: "Lista completa nova, na ordem (substitui a atual). Use só para reordenar/reescrever tudo.",
        },
        apelidos_adicionar: {
          type: "array",
          items: { type: "string" },
          description: "Outros nomes que o cliente usa para este benefício.",
        },
        orientacoes_ia: {
          type: "string",
          description:
            "Texto COMPLETO novo de 'o que a IA precisa saber' (substitui o atual). Para só acrescentar, use orientacoes_acrescentar.",
        },
        orientacoes_acrescentar: {
          type: "string",
          description: "Linhas a acrescentar no fim de 'o que a IA precisa saber'.",
        },
        motivo: {
          type: "string",
          description: "Por que este ajuste resolve o problema (aparece no card).",
        },
      },
    },
  },
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function lista(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean) : [];
}

function fold(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function corta(v: unknown, max: number): unknown {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
  return s.length > max ? `${s.slice(0, max)}…` : typeof v === "string" ? v : JSON.parse(s);
}

async function exigirAdvogado(): Promise<string | null> {
  const user = await getAppUser().catch(() => null);
  if (!user) return "Não autenticado.";
  if (user.papel !== "advogado") {
    return "Só advogado pode analisar e ajustar a IA do WhatsApp. Explique isso ao usuário.";
  }
  return null;
}

function tipoPublico(t: TipoCasoMatch) {
  return {
    id: t.id,
    chave: t.chave,
    nome: t.label,
    apelidos: t.aliases,
    documentos: t.documentos,
    o_que_a_ia_precisa_saber: t.orientacoes_ia || null,
    ativo: t.ativo,
  };
}

export async function toolLerTiposCaso(args: Record<string, unknown>): Promise<AssistenteToolResult> {
  const tipos = await listTiposCaso({ includeInactive: args.incluir_inativos === true });
  const beneficio = str(args.beneficio);
  if (beneficio) {
    const t = matchTipoCaso(tipos, beneficio);
    return {
      ok: true,
      summary: `Para "${beneficio}" a IA usa o tipo "${t.label}" (${t.documentos.length} documentos).`,
      links: [{ label: "Tipos de caso", href: "/configuracoes" }],
      data: tipoPublico(t),
    };
  }
  return {
    ok: true,
    summary: `${tipos.length} tipo(s) de caso.`,
    links: [{ label: "Tipos de caso", href: "/configuracoes" }],
    data: tipos.map(tipoPublico),
  };
}

export async function toolDiagnosticarAtendimentoIA(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const negado = await exigirAdvogado();
  if (negado) return { ok: false, summary: negado };

  const raw = str(args.contact_norm) || str(args.telefone);
  if (!raw) return { ok: false, summary: "Informe o telefone (contact_norm) do cliente." };
  const contato = phoneToContactNorm(raw);
  const nMsgs = Math.min(Math.max(Number(args.mensagens) || 30, 1), 60);
  const nExec = Math.min(Math.max(Number(args.execucoes) || 6, 1), 15);

  const supabase = createServiceClient();
  const [msgs, execs, config, estado] = await Promise.all([
    supabase
      .from("mensagens")
      .select("id, type, session_id, mensage_type, text, ia_conteudo, created_at")
      .eq("contact_norm", contato)
      .order("id", { ascending: false })
      .limit(nMsgs),
    supabase
      .from("app_ia_execucoes")
      .select("created_at, status, entrada, respostas, ferramentas, prompt_origem, modelo, erro")
      .eq("telefone", contato)
      .order("id", { ascending: false })
      .limit(nExec),
    supabase
      .from("app_ia_whatsapp_config")
      .select("modo, numeros_teste, usar_rascunho_no_teste, debounce_segundos")
      .maybeSingle(),
    supabase
      .from("app_ia_estado")
      .select("pausada, pausada_motivo, memoria_desde")
      .eq("telefone", contato)
      .maybeSingle(),
  ]);
  if (msgs.error) return { ok: false, summary: msgs.error.message };

  const conversa = [...(msgs.data ?? [])].reverse().map((m) => ({
    quando: m.created_at,
    quem:
      m.type === "lead" || m.type === "human"
        ? "cliente"
        : m.session_id === "ia"
          ? "IA"
          : "equipe",
    tipo: m.mensage_type,
    texto: corta(m.text ?? "", 600),
    ...(m.ia_conteudo && m.mensage_type !== "text"
      ? { como_a_ia_leu: corta(m.ia_conteudo, 400) }
      : {}),
  }));

  const respostasDaIA = [...(execs.data ?? [])].reverse().map((e) => ({
    quando: e.created_at,
    status: e.status,
    recebeu: corta(e.entrada ?? "", 600),
    respondeu: e.respostas,
    ferramentas: Array.isArray(e.ferramentas)
      ? (e.ferramentas as { nome?: string; argumentos?: unknown; resultado?: unknown; erro?: string }[]).map(
          (f) => ({
            nome: f.nome,
            argumentos: corta(f.argumentos, 400),
            resultado: corta(f.resultado, 1200),
            ...(f.erro ? { erro: f.erro } : {}),
          })
        )
      : [],
    prompt: e.prompt_origem,
    ...(e.erro ? { erro: e.erro } : {}),
  }));

  const cfg = config.data;
  const href = assistenteAtendimentoHref(contato);
  return {
    ok: true,
    summary: `${conversa.length} mensagens e ${respostasDaIA.length} respostas da IA de ${contato}.`,
    links: [{ label: "Abrir atendimento", href }],
    data: {
      contato,
      ia_neste_contato: {
        modo_geral: cfg?.modo ?? null,
        numero_de_teste: cfg?.numeros_teste?.includes(contato) ?? false,
        usa_rascunho_do_prompt:
          Boolean(cfg?.usar_rascunho_no_teste) && Boolean(cfg?.numeros_teste?.includes(contato)),
        pausada: estado.data?.pausada ?? false,
        motivo_pausa: estado.data?.pausada_motivo ?? null,
        memoria_desde: estado.data?.memoria_desde ?? null,
      },
      conversa,
      respostas_da_ia: respostasDaIA,
    },
  };
}

type ProposeOk = {
  ok: true;
  normalizedArgs: Record<string, unknown>;
  label: string;
  summary: string;
  details?: string[];
};
type ProposeErr = { ok: false; summary: string };

function resumoTexto(v: string, max = 220): string {
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return "(vazio)";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export async function proposeAlteracaoTipoCaso(
  args: Record<string, unknown>
): Promise<ProposeOk | ProposeErr> {
  const negado = await exigirAdvogado();
  if (negado) return { ok: false, summary: negado };

  const novoNome = str(args.novo_tipo_nome);
  const ref = str(args.tipo);
  let atual: TipoCasoMatch | null = null;

  if (!novoNome) {
    if (!ref) return { ok: false, summary: "Informe o tipo (chave, nome ou id) ou novo_tipo_nome." };
    const tipos = await listTiposCaso({ includeInactive: true, allowFallback: false });
    const alvo = fold(ref);
    atual =
      tipos.find((t) => t.id === ref) ??
      tipos.find((t) => fold(t.chave) === alvo || fold(t.label) === alvo) ??
      tipos.find((t) => t.aliases.some((a) => fold(a) === alvo)) ??
      null;
    if (!atual?.id) {
      return {
        ok: false,
        summary: `Tipo "${ref}" não encontrado em Tipos de caso. Chame ler_tipos_caso e use a chave exata, ou crie com novo_tipo_nome.`,
      };
    }
  }

  const docsAntes = atual?.documentos ?? [];
  let docs = lista(args.documentos).length ? lista(args.documentos) : [...docsAntes];
  const remover = lista(args.documentos_remover).map(fold);
  docs = docs.filter((d) => !remover.includes(fold(d)));
  for (const d of lista(args.documentos_adicionar)) {
    if (!docs.some((x) => fold(x) === fold(d))) docs.push(d);
  }

  const aliasesAntes = atual?.aliases ?? [];
  const aliases = [...aliasesAntes];
  for (const a of lista(args.apelidos_adicionar)) {
    if (!aliases.some((x) => fold(x) === fold(a))) aliases.push(a);
  }

  const orientAntes = atual?.orientacoes_ia ?? "";
  let orient = typeof args.orientacoes_ia === "string" ? args.orientacoes_ia.trim() : orientAntes;
  const acrescentar = str(args.orientacoes_acrescentar);
  if (acrescentar) orient = orient ? `${orient}\n${acrescentar}` : acrescentar;

  const details: string[] = [];
  const entraram = docs.filter((d) => !docsAntes.some((x) => fold(x) === fold(d)));
  const sairam = docsAntes.filter((d) => !docs.some((x) => fold(x) === fold(d)));
  if (entraram.length) details.push(`Documentos + ${entraram.join(", ")}`);
  if (sairam.length) details.push(`Documentos − ${sairam.join(", ")}`);
  if (!entraram.length && !sairam.length && docs.join("|") !== docsAntes.join("|")) {
    details.push(`Nova ordem dos documentos: ${docs.join(" → ")}`);
  }
  const apelidosNovos = aliases.slice(aliasesAntes.length);
  if (apelidosNovos.length) details.push(`Apelidos + ${apelidosNovos.join(", ")}`);
  if (orient !== orientAntes) {
    details.push(`O que a IA precisa saber — antes: ${resumoTexto(orientAntes)}`);
    details.push(`O que a IA precisa saber — depois: ${resumoTexto(orient, 600)}`);
  }
  const motivo = str(args.motivo);
  if (motivo) details.push(`Motivo: ${motivo}`);

  if (!novoNome && details.length === (motivo ? 1 : 0)) {
    return { ok: false, summary: "Nada muda nesse tipo de caso com esses parâmetros." };
  }

  const nome = novoNome || atual!.label;
  return {
    ok: true,
    normalizedArgs: {
      id: atual?.id ?? null,
      novo_tipo_nome: novoNome || null,
      documentos: docs,
      aliases,
      orientacoes_ia: orient,
    },
    label: novoNome ? `Criar tipo de caso "${nome}"` : `Ajustar tipo de caso "${nome}"`,
    summary: `${novoNome ? "Criar" : "Ajustar"} o tipo de caso "${nome}": ${details.join("; ")}`,
    details: novoNome ? [`Documentos: ${docs.join(", ") || "(nenhum)"}`, ...details] : details,
  };
}

export async function execAlteracaoTipoCaso(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const documentos = lista(args.documentos);
  const aliases = lista(args.aliases);
  const orientacoes_ia = typeof args.orientacoes_ia === "string" ? args.orientacoes_ia : "";
  const id = str(args.id);
  const novoNome = str(args.novo_tipo_nome);

  if (id) {
    const row = await atualizarTipoCaso({ id, documentos, aliases, orientacoes_ia });
    return {
      ok: true,
      summary: `Tipo de caso "${row.label}" atualizado. A IA do WhatsApp já usa a versão nova na próxima resposta.`,
      links: [{ label: "Tipos de caso", href: "/configuracoes" }],
    };
  }
  if (!novoNome) return { ok: false, summary: "Tipo de caso não informado." };
  const row = await criarTipoCaso({ label: novoNome, documentos, aliases, orientacoes_ia });
  return {
    ok: true,
    summary: `Tipo de caso "${row.label}" criado. A IA do WhatsApp já pode usá-lo.`,
    links: [{ label: "Tipos de caso", href: "/configuracoes" }],
  };
}
