"use server";

import { createClient } from "@/lib/supabase/server";
import { normalizeCpf } from "@/lib/utils/cpf";

export type ResultadoBusca = {
  tipo: "cliente" | "caso" | "conversa";
  titulo: string;
  subtitulo: string;
  href: string;
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
      .select("nome, cpf, numero_processo, tribunal")
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
      .select("id, nome, cpf, beneficio_identificado, status")
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
    resultados.push({
      tipo: "cliente",
      titulo: p.nome,
      subtitulo: `Processo ${p.numero_processo}${p.tribunal ? ` · ${p.tribunal}` : ""}`,
      href: `/clientes/${normalizeCpf(p.cpf)}`,
    });
  }

  for (const c of casos.data ?? []) {
    resultados.push({
      tipo: "caso",
      titulo: c.nome ?? "Caso sem nome",
      subtitulo: c.beneficio_identificado ?? "Benefício não identificado",
      href: `/kanban/${c.id}`,
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
    });
    if (vistos.size >= 3) break;
  }

  return resultados.slice(0, 12);
}
