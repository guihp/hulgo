import { buscarGlobal } from "@/lib/actions/busca";
import { loadFichaPessoa } from "@/lib/data/ficha";
import {
  assistenteAtendimentoHref,
  assistenteFichaArquivosHref,
  assistenteFichaHref,
  assistenteKanbanHref,
} from "@/lib/assistente/links";
import { createClient } from "@/lib/supabase/server";
import { brazilCalendarDayBounds } from "@/lib/utils/dates";
import { normalizeCpf } from "@/lib/utils/cpf";
import { phoneToContactNorm } from "@/lib/utils/phone";
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
        "Carrega a ficha 360 de uma pessoa (processos, casos, prazos, contagem de mensagens). Informe cpf e/ou telefone/contact_norm.",
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
        "Lista prazos (app_prazos). Pode filtrar por CPF, próximos N dias ou só abertos.",
      parameters: {
        type: "object",
        properties: {
          cpf: { type: "string" },
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
      summary: `Nenhuma pessoa para "${termo}". Ofereça criar_cliente_caso + salvar anexo (se houver) ou peça CPF/telefone/outra grafia.`,
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

  const resumo = {
    cpf: ficha.cpf,
    contact_norm: ficha.contactNorm,
    href,
    arquivos_href: arquivosHref,
    processos: ficha.processos.map((p) => ({
      id: p.id,
      nome: p.nome,
      numero_processo: p.numero_processo,
      tribunal: p.tribunal,
      telefone: p.telefone,
    })),
    casos: ficha.casos.map((c) => ({
      id: c.id,
      nome: c.nome,
      status: c.status,
      beneficio: c.beneficio_identificado,
      telefone: c.telefone,
      href: assistenteKanbanHref(c.id),
    })),
    prazos: ficha.prazos.map((p) => ({
      id: p.id,
      titulo: p.titulo,
      data_prazo: p.data_prazo,
      tipo: p.tipo,
      concluido: p.concluido,
    })),
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

  return {
    ok: true,
    summary: `Ficha de ${nome}: ${resumo.casos.length} caso(s), ${resumo.processos.length} processo(s), ${resumo.prazos.length} prazo(s), ${resumo.mensagens_count} mensagem(ns). Ficha: ${href}. Arquivos: ${arquivosHref}.`,
    links: [
      { label: "Abrir ficha", href },
      { label: "Pastas / arquivos", href: arquivosHref },
      ...casoLinks,
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

  let query = supabase
    .from("app_prazos")
    .select(
      "id, titulo, tipo, data_prazo, descricao, cpf, caso_id, processo_id, concluido"
    )
    .order("data_prazo", { ascending: true })
    .limit(limite);

  if (apenasAbertos) query = query.eq("concluido", false);
  if (cpf) query = query.eq("cpf", cpf);
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
  if (!rows.length) {
    return { ok: true, summary: "Nenhum prazo encontrado.", data: [] };
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
      return { label: p.titulo, href: "/prazos" };
    })
    .slice(0, 12);

  return {
    ok: true,
    summary: `${rows.length} prazo(s) encontrado(s).`,
    links,
    data: rows,
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
      case "listar_conversa_resumo":
        return await toolListarConversaResumo(args);
      case "resumo_atendimentos_hoje":
        return await toolResumoAtendimentosHoje(args);
      default:
        return { ok: false, summary: `Ferramenta desconhecida: ${name}` };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao executar ferramenta";
    return { ok: false, summary: msg };
  }
}
