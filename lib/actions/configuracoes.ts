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

export type AgenteConfigVersaoFonte =
  | "ui"
  | "assistente"
  | "publicacao"
  | "reverter";

export type AgenteConfigVersao = {
  id: string;
  persona: string;
  mensagem_abertura: string;
  publicado: boolean;
  fonte: AgenteConfigVersaoFonte;
  motivo: string | null;
  config_versao: number | null;
  created_by: string | null;
  created_at: string;
};

export type SalvarRascunhoAgenteMeta = {
  fonte?: AgenteConfigVersaoFonte;
  motivo?: string | null;
};

async function requireAdvogado() {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (user.papel !== "advogado") throw new Error("Sem permissão");
  return user;
}

function mapAgenteConfigRow(data: {
  persona: string | null;
  mensagem_abertura: string | null;
  persona_rascunho: string | null;
  mensagem_abertura_rascunho: string | null;
  versao: number | null;
  published_at: string | null;
  updated_at: string | null;
}): AgenteConfig {
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

/** Persists a snapshot of persona + abertura into history (best-effort log on failure). */
async function inserirSnapshotAgente(input: {
  persona: string;
  mensagem_abertura: string;
  publicado: boolean;
  fonte: AgenteConfigVersaoFonte;
  motivo?: string | null;
  config_versao?: number | null;
  created_by: string;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("app_agente_config_versoes").insert({
    persona: input.persona,
    mensagem_abertura: input.mensagem_abertura,
    publicado: input.publicado,
    fonte: input.fonte,
    motivo: input.motivo?.trim() || null,
    config_versao: input.config_versao ?? null,
    created_by: input.created_by,
  });
  if (error) {
    console.error("[agente-config] falha ao gravar histórico:", error.message);
  }
}

function rascunhoEfetivo(row: {
  persona: string | null;
  mensagem_abertura: string | null;
  persona_rascunho: string | null;
  mensagem_abertura_rascunho: string | null;
}): { persona: string; mensagem_abertura: string } {
  const personaRascunho = (row.persona_rascunho ?? "").trim();
  const aberturaRascunho = (row.mensagem_abertura_rascunho ?? "").trim();
  return {
    persona: personaRascunho || row.persona || "",
    mensagem_abertura: aberturaRascunho || row.mensagem_abertura || "",
  };
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

  const efetivo = rascunhoEfetivo(data);
  return {
    persona: efetivo.persona,
    mensagem_abertura: efetivo.mensagem_abertura,
    persona_publicada: data.persona ?? "",
    mensagem_abertura_publicada: data.mensagem_abertura ?? "",
    versao: data.versao ?? 0,
    published_at: data.published_at ?? null,
    updated_at: data.updated_at ?? null,
  };
}

export async function salvarRascunhoAgente(
  input: {
    persona: string;
    mensagem_abertura: string;
  },
  meta?: SalvarRascunhoAgenteMeta
): Promise<AgenteConfig> {
  const user = await requireAdvogado();
  const supabase = await createClient();
  const now = new Date().toISOString();
  const fonte: AgenteConfigVersaoFonte =
    meta?.fonte === "assistente" ||
    meta?.fonte === "reverter" ||
    meta?.fonte === "ui" ||
    meta?.fonte === "publicacao"
      ? meta.fonte
      : "ui";

  const { data: current, error: readError } = await supabase
    .from("app_agente_config")
    .select(
      "persona, mensagem_abertura, persona_rascunho, mensagem_abertura_rascunho, versao"
    )
    .eq("id", 1)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  if (current) {
    const prev = rascunhoEfetivo(current);
    const changed =
      prev.persona !== input.persona ||
      prev.mensagem_abertura !== input.mensagem_abertura;
    if (changed && (prev.persona.trim() || prev.mensagem_abertura.trim())) {
      await inserirSnapshotAgente({
        persona: prev.persona,
        mensagem_abertura: prev.mensagem_abertura,
        publicado: false,
        fonte,
        motivo: meta?.motivo ?? "Antes de salvar rascunho",
        config_versao: current.versao ?? null,
        created_by: user.id,
      });
    }
  }

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

  return mapAgenteConfigRow(data);
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
    .select(
      "persona, mensagem_abertura, persona_rascunho, mensagem_abertura_rascunho, versao"
    )
    .eq("id", 1)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const nextVersao = (current?.versao ?? 0) + 1;
  const now = new Date().toISOString();

  // Snapshot previous published content if it differs from what we're publishing.
  if (current) {
    const prevPubPersona = current.persona ?? "";
    const prevPubAbertura = current.mensagem_abertura ?? "";
    if (
      (prevPubPersona.trim() || prevPubAbertura.trim()) &&
      (prevPubPersona !== persona || prevPubAbertura !== mensagem_abertura)
    ) {
      await inserirSnapshotAgente({
        persona: prevPubPersona,
        mensagem_abertura: prevPubAbertura,
        publicado: true,
        fonte: "publicacao",
        motivo: "Antes de publicar",
        config_versao: current.versao ?? null,
        created_by: user.id,
      });
    }
  }

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

  await inserirSnapshotAgente({
    persona,
    mensagem_abertura,
    publicado: true,
    fonte: "publicacao",
    motivo: `Publicado v${nextVersao}`,
    config_versao: nextVersao,
    created_by: user.id,
  });

  revalidatePath("/configuracoes");

  return mapAgenteConfigRow(data);
}

/** Lista versões recentes do prompt (mais novas primeiro). Só advogado. */
export async function listAgenteConfigVersoes(opts?: {
  limite?: number;
}): Promise<AgenteConfigVersao[]> {
  await requireAdvogado();
  const limite = Math.min(Math.max(opts?.limite ?? 20, 1), 50);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_agente_config_versoes")
    .select(
      "id, persona, mensagem_abertura, publicado, fonte, motivo, config_versao, created_by, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    persona: row.persona ?? "",
    mensagem_abertura: row.mensagem_abertura ?? "",
    publicado: Boolean(row.publicado),
    fonte: (row.fonte as AgenteConfigVersaoFonte) || "ui",
    motivo: row.motivo ?? null,
    config_versao: row.config_versao ?? null,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
  }));
}

/** Carrega um snapshot por id. Só advogado. */
export async function getAgenteConfigVersao(
  id: string
): Promise<AgenteConfigVersao | null> {
  await requireAdvogado();
  const trimmed = id.trim();
  if (!trimmed) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_agente_config_versoes")
    .select(
      "id, persona, mensagem_abertura, publicado, fonte, motivo, config_versao, created_by, created_at"
    )
    .eq("id", trimmed)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    persona: data.persona ?? "",
    mensagem_abertura: data.mensagem_abertura ?? "",
    publicado: Boolean(data.publicado),
    fonte: (data.fonte as AgenteConfigVersaoFonte) || "ui",
    motivo: data.motivo ?? null,
    config_versao: data.config_versao ?? null,
    created_by: data.created_by ?? null,
    created_at: data.created_at,
  };
}
