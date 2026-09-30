"use server";

import { createClient } from "@/lib/supabase/server";
import { normalizeCpf } from "@/lib/utils/cpf";

export type ResultadoBusca = {
  tipo: "cliente" | "caso" | "conversa";
  titulo: string;
  subtitulo: string;
  href: string;
  /** Identity helpers for assistente disambiguation (optional for ⌘K). */
  cpf?: string | null;
  telefone?: string | null;
};

export async function buscarGlobal(termo: string): Promise<ResultadoBusca[]> {
  const q = termo.trim();
  if (q.length < 2) return [];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const digits = q.replace(/\D/g, "");
  const like = `%${q}%`;
  const resultados: ResultadoBusca[] = [];

  const [processos, casos, conversas] = await Promise.all([
    supabase
      .from("processos_clientes")
      .select("nome, cpf, telefone, numero_processo, tribunal")
      .or(
        [
          `nome.ilike.${like}`,
          `numero_processo.ilike.${like}`,
          ...(digits.length >= 3
            ? [`cpf.ilike.%${digits}%`, `telefone.ilike.%${digits}%`]
            : []),
        ].join(",")
      )
      .limit(5),
    supabase
      .from("casos_novos")
      .select("id, nome, cpf, telefone, beneficio_identificado, status")
      .or(
        [
          `nome.ilike.${like}`,
          `beneficio_identificado.ilike.${like}`,
          ...(digits.length >= 3
            ? [`cpf.ilike.%${digits}%`, `telefone.ilike.%${digits}%`]
            : []),
        ].join(",")
      )
      .limit(5),
    digits.length >= 4
      ? supabase
          .from("mensagens")
          .select("contact_norm, phone")
          .ilike("contact_norm", `%${digits}%`)
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] as { contact_norm: string | null; phone: string | null }[] }),
  ]);

  for (const p of processos.data ?? []) {
    const cpf = p.cpf ? normalizeCpf(p.cpf) : null;
    resultados.push({
      tipo: "cliente",
      titulo: p.nome,
      subtitulo: `Processo ${p.numero_processo}${p.tribunal ? ` · ${p.tribunal}` : ""}`,
      href: `/clientes/${cpf ?? normalizeCpf(p.cpf)}`,
      cpf,
      telefone: p.telefone ?? null,
    });
  }

  for (const c of casos.data ?? []) {
    const cpf = c.cpf ? normalizeCpf(c.cpf) : null;
    resultados.push({
      tipo: "caso",
      titulo: c.nome ?? "Caso sem nome",
      subtitulo: c.beneficio_identificado ?? "Benefício não identificado",
      href: `/kanban/${c.id}`,
      cpf,
      telefone: c.telefone ?? null,
    });
  }

  const vistos = new Set<string>();
  for (const m of conversas.data ?? []) {
    const contact = m.contact_norm ?? "";
    if (!contact || vistos.has(contact)) continue;
    vistos.add(contact);
    resultados.push({
      tipo: "conversa",
      titulo: m.phone ?? contact,
      subtitulo: "Conversa no WhatsApp",
      href: `/atendimentos/${contact}`,
      telefone: contact,
    });
    if (vistos.size >= 3) break;
  }

  return resultados.slice(0, 12);
}

export type ClienteBusca = {
  nome: string;
  cpf: string | null;
  telefone: string | null;
  data_nascimento: string | null;
  /** Onde a pessoa foi encontrada (processo judicial ou caso de triagem). */
  origem: "processo" | "caso";
};

/** Pessoas existentes (processos + casos) para preencher um novo processo. */
export async function buscarClientesParaProcesso(
  termo: string
): Promise<ClienteBusca[]> {
  const q = termo.trim();
  if (q.length < 2) return [];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const digits = q.replace(/\D/g, "");
  const filtro = [
    `nome.ilike.%${q.replace(/[,()]/g, " ")}%`,
    ...(digits.length >= 3
      ? [`cpf.ilike.%${digits}%`, `telefone.ilike.%${digits}%`]
      : []),
  ].join(",");

  const [processos, casos] = await Promise.all([
    supabase
      .from("processos_clientes")
      .select("nome, cpf, telefone, data_nascimento")
      .or(filtro)
      .order("id", { ascending: false })
      .limit(10),
    supabase
      .from("casos_novos")
      .select("nome, cpf, telefone, data_nascimento")
      .or(filtro)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const out: ClienteBusca[] = [];
  const vistos = new Set<string>();
  const add = (
    r: {
      nome: string | null;
      cpf: string | null;
      telefone: string | null;
      data_nascimento: string | null;
    },
    origem: ClienteBusca["origem"]
  ) => {
    const cpf = r.cpf ? normalizeCpf(r.cpf) : null;
    const tel = r.telefone?.replace(/\D/g, "") || null;
    const key = cpf || tel || r.nome?.trim().toLowerCase();
    if (!key || vistos.has(key)) return;
    vistos.add(key);
    if (cpf && tel) vistos.add(tel);
    out.push({
      nome: r.nome?.trim() || "Sem nome",
      cpf,
      telefone: r.telefone ?? null,
      data_nascimento: r.data_nascimento ?? null,
      origem,
    });
  };
  for (const p of processos.data ?? []) add(p, "processo");
  for (const c of casos.data ?? []) add(c, "caso");
  return out.slice(0, 10);
}
