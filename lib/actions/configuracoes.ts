"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import type { AppConfigKey } from "@/lib/config/app-config";

export type EquipeMember = {
  id: string;
  nome: string;
  papel: string;
  ativo: boolean;
};

export type AgenteConfig = {
  persona: string;
  mensagem_abertura: string;
  persona_publicada: string;
  mensagem_abertura_publicada: string;
  versao: number;
  published_at: string | null;
  updated_at: string | null;
};

async function requireAdvogado() {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (user.papel !== "advogado") throw new Error("Sem permissão");
  return user;
}

export async function listEquipe(): Promise<EquipeMember[]> {
  await requireAdvogado();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_usuarios")
    .select("id, nome, papel, ativo")
    .order("nome");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    nome: row.nome,
    papel: row.papel,
    ativo: row.ativo,
  }));
}

const EDITABLE_KEYS: AppConfigKey[] = [
  "escritorio_nome",
  "whatsapp_instancia",
];

export async function salvarDadosEscritorio(input: {
  escritorio_nome: string;
  whatsapp_instancia: string;
}): Promise<void> {
  await requireAdvogado();
  const supabase = await createClient();

  const rows: { chave: AppConfigKey; valor: string }[] = [
    { chave: "escritorio_nome", valor: input.escritorio_nome.trim() },
    { chave: "whatsapp_instancia", valor: input.whatsapp_instancia.trim() },
  ];

  for (const row of rows) {
    if (!EDITABLE_KEYS.includes(row.chave)) continue;
    // RLS allows UPDATE for advogado; keys are seeded by migration (no INSERT policy).
    const { error } = await supabase
      .from("app_config")
      .update({
        valor: row.valor,
        updated_at: new Date().toISOString(),
      })
      .eq("chave", row.chave);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/configuracoes");
}

export async function getAgenteConfig(): Promise<AgenteConfig | null> {
  await requireAdvogado();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_agente_config")
    .select(
      "persona, mensagem_abertura, persona_rascunho, mensagem_abertura_rascunho, versao, published_at, updated_at"
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const personaRascunho = (data.persona_rascunho ?? "").trim();
  const aberturaRascunho = (data.mensagem_abertura_rascunho ?? "").trim();
  const personaPub = data.persona ?? "";
  const aberturaPub = data.mensagem_abertura ?? "";

  return {
    persona: personaRascunho || personaPub,
    mensagem_abertura: aberturaRascunho || aberturaPub,
    persona_publicada: personaPub,
    mensagem_abertura_publicada: aberturaPub,
    versao: data.versao ?? 0,
    published_at: data.published_at ?? null,
    updated_at: data.updated_at ?? null,
  };
}

export async function salvarRascunhoAgente(input: {
  persona: string;
  mensagem_abertura: string;
}): Promise<AgenteConfig> {
  const user = await requireAdvogado();
  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("app_agente_config")
    .update({
      persona_rascunho: input.persona,
      mensagem_abertura_rascunho: input.mensagem_abertura,
      updated_at: now,
      updated_by: user.id,
    })
    .eq("id", 1)
    .select(
      "persona, mensagem_abertura, persona_rascunho, mensagem_abertura_rascunho, versao, published_at, updated_at"
    )
    .single();
  if (error) throw new Error(error.message);

  return {
    persona: data.persona_rascunho ?? "",
    mensagem_abertura: data.mensagem_abertura_rascunho ?? "",
    persona_publicada: data.persona ?? "",
    mensagem_abertura_publicada: data.mensagem_abertura ?? "",
    versao: data.versao ?? 0,
    published_at: data.published_at ?? null,
    updated_at: data.updated_at ?? null,
  };
}

export async function publicarAgenteConfig(input: {
  persona: string;
  mensagem_abertura: string;
}): Promise<AgenteConfig> {
  const user = await requireAdvogado();
  const persona = input.persona.trim();
  const mensagem_abertura = input.mensagem_abertura.trim();
  if (!persona) throw new Error("Persona e regras não podem ficar vazias");
  if (!mensagem_abertura) throw new Error("Mensagem de abertura não pode ficar vazia");

  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("app_agente_config")
    .select("versao")
    .eq("id", 1)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const nextVersao = (current?.versao ?? 0) + 1;
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("app_agente_config")
    .update({
      persona_rascunho: persona,
      mensagem_abertura_rascunho: mensagem_abertura,
      persona,
      mensagem_abertura,
      versao: nextVersao,
      published_at: now,
      published_by: user.id,
      updated_at: now,
      updated_by: user.id,
    })
    .eq("id", 1)
    .select(
      "persona, mensagem_abertura, persona_rascunho, mensagem_abertura_rascunho, versao, published_at, updated_at"
    )
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/configuracoes");

  return {
    persona: data.persona_rascunho ?? persona,
    mensagem_abertura: data.mensagem_abertura_rascunho ?? mensagem_abertura,
    persona_publicada: data.persona ?? persona,
    mensagem_abertura_publicada: data.mensagem_abertura ?? mensagem_abertura,
    versao: data.versao ?? nextVersao,
    published_at: data.published_at ?? now,
    updated_at: data.updated_at ?? now,
  };
}
