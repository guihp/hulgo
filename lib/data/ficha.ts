import { fetchFichaArquivos, type MidiaChat } from "@/lib/data/arquivos";
import { createClient } from "@/lib/supabase/server";
import { normalizeCpf } from "@/lib/utils/cpf";
import { phoneToContactNorm } from "@/lib/utils/phone";
import type { Tables } from "@/types/database";

export type FichaPessoa = {
  cpf: string | null;
  contactNorm: string;
  contactNorms: string[];
  processos: Tables<"processos_clientes">[];
  casos: Tables<"casos_novos">[];
  mensagens: Tables<"mensagens">[];
  prazos: Tables<"app_prazos">[];
  documentos: Tables<"documentos_cliente">[];
  pastas: Tables<"documentos_pastas">[];
  midiasChat: MidiaChat[];
};

export async function loadFichaPessoa(opts: {
  cpf?: string | null;
  contactNorm?: string | null;
}): Promise<FichaPessoa | null> {
  const supabase = await createClient();
  const cpf = opts.cpf ? normalizeCpf(opts.cpf) : "";
  const contact = opts.contactNorm ? phoneToContactNorm(opts.contactNorm) : "";

  let processos: Tables<"processos_clientes">[] = [];
  let casos: Tables<"casos_novos">[] = [];

  if (cpf) {
    const [pRes, cRes] = await Promise.all([
      supabase.from("processos_clientes").select("*").eq("cpf", cpf),
      supabase.from("casos_novos").select("*").eq("cpf", cpf),
    ]);
    processos = pRes.data ?? [];
    casos = cRes.data ?? [];
  } else if (contact) {
    const [{ data: allProcessos }, { data: allCasos }] = await Promise.all([
      supabase.from("processos_clientes").select("*"),
      supabase.from("casos_novos").select("*"),
    ]);
    processos = (allProcessos ?? []).filter(
      (p) => phoneToContactNorm(p.telefone) === contact
    );
    casos = (allCasos ?? []).filter(
      (c) => phoneToContactNorm(c.telefone) === contact
    );
  }

  const telefones = [
    ...processos.map((p) => phoneToContactNorm(p.telefone)),
    ...casos.map((c) => phoneToContactNorm(c.telefone)),
    contact,
  ].filter(Boolean);
  const contactNorms = [...new Set(telefones)];

  if (cpf && contactNorms.length) {
    const [{ data: extraProcessos }, { data: extraCasos }] = await Promise.all([
      supabase.from("processos_clientes").select("*"),
      supabase.from("casos_novos").select("*"),
    ]);
    const processoIds = new Set(processos.map((p) => p.id));
    const casoIds = new Set(casos.map((c) => c.id));
    for (const p of extraProcessos ?? []) {
      if (
        !processoIds.has(p.id) &&
        contactNorms.includes(phoneToContactNorm(p.telefone))
      ) {
        processos.push(p);
      }
    }
    for (const c of extraCasos ?? []) {
      if (
        !casoIds.has(c.id) &&
        contactNorms.includes(phoneToContactNorm(c.telefone))
      ) {
        casos.push(c);
      }
    }
  }
  const contactNorm = contactNorms[0] ?? contact;

  const cpfResolvido =
    cpf ||
    processos.find((p) => p.cpf)?.cpf ||
    casos.find((c) => c.cpf)?.cpf ||
    null;
  const cpfNorm = cpfResolvido ? normalizeCpf(cpfResolvido) : null;

  let mensagens: Tables<"mensagens">[] = [];
  if (contactNorms.length) {
    const { data } = await supabase
      .from("mensagens")
      .select("*")
      .in("contact_norm", contactNorms)
      .order("created_at", { ascending: true });
    mensagens = data ?? [];
  }

  const prazosRes = cpfNorm
    ? await supabase
        .from("app_prazos")
        .select("*")
        .eq("cpf", cpfNorm)
        .order("data_prazo", { ascending: true })
    : { data: [] as Tables<"app_prazos">[] };

  if (
    !processos.length &&
    !casos.length &&
    !mensagens.length
  ) {
    return null;
  }

  const arquivos = await fetchFichaArquivos({
    cpf: cpfNorm,
    contactNorms,
    casoIds: casos.map((c) => c.id),
  });

  return {
    cpf: cpfNorm,
    contactNorm,
    contactNorms,
    processos,
    casos,
    mensagens,
    prazos: prazosRes.data ?? [],
    documentos: arquivos.documentos,
    pastas: arquivos.pastas,
    midiasChat: arquivos.midiasChat,
  };
}
