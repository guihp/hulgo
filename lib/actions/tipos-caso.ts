"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import {
  checklistDoBeneficio,
  listTiposCaso,
  type TipoCasoMatch,
} from "@/lib/data/tipos-caso";

export type { TipoCasoMatch };

function slugifyChave(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function normalizeAliases(aliases: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of aliases) {
    const t = a.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function normalizeDocs(docs: string[]): string[] {
  return docs.map((d) => d.trim()).filter(Boolean);
}

async function requireAdvogado() {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (user.papel !== "advogado") {
    throw new Error("Apenas advogados podem gerenciar tipos de caso");
  }
  return user;
}

function revalidateTipos() {
  revalidatePath("/configuracoes");
  revalidatePath("/kanban");
}

export async function listarTiposCasoAction(includeInactive = true) {
  await requireAdvogado();
  return listTiposCaso({ includeInactive });
}

export async function resolverChecklistBeneficioAction(
  beneficio: string | null | undefined
) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  return checklistDoBeneficio(beneficio);
}

export type CriarTipoCasoInput = {
  chave?: string;
  label: string;
  aliases?: string[];
  documentos?: string[];
  ordem?: number;
};

export async function criarTipoCaso(input: CriarTipoCasoInput) {
  await requireAdvogado();

  const label = input.label.trim();
  if (!label) throw new Error("Nome do tipo é obrigatório");

  const chave = slugifyChave(input.chave?.trim() || label);
  if (!chave) throw new Error("Chave inválida");

  const supabase = await createClient();
  const { data: maxOrdem } = await supabase
    .from("app_tipos_caso")
    .select("ordem")
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ordem = input.ordem ?? ((maxOrdem?.ordem ?? 0) + 10);

  const { data, error } = await supabase
    .from("app_tipos_caso")
    .insert({
      chave,
      label,
      aliases: normalizeAliases(input.aliases ?? []),
      documentos: normalizeDocs(input.documentos ?? []),
      ativo: true,
      ordem,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(`Já existe um tipo com a chave "${chave}"`);
    }
    throw new Error(error.message);
  }

  revalidateTipos();
  return data;
}

export type AtualizarTipoCasoInput = {
  id: string;
  label?: string;
  aliases?: string[];
  documentos?: string[];
  ordem?: number;
  ativo?: boolean;
};

export async function atualizarTipoCaso(input: AtualizarTipoCasoInput) {
  await requireAdvogado();
  if (!input.id) throw new Error("id é obrigatório");

  const patch: {
    updated_at: string;
    label?: string;
    aliases?: string[];
    documentos?: string[];
    ordem?: number;
    ativo?: boolean;
  } = {
    updated_at: new Date().toISOString(),
  };

  if (input.label !== undefined) {
    const label = input.label.trim();
    if (!label) throw new Error("Nome do tipo é obrigatório");
    patch.label = label;
  }
  if (input.aliases !== undefined) {
    patch.aliases = normalizeAliases(input.aliases);
  }
  if (input.documentos !== undefined) {
    patch.documentos = normalizeDocs(input.documentos);
  }
  if (input.ordem !== undefined) patch.ordem = input.ordem;
  if (input.ativo !== undefined) patch.ativo = input.ativo;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_tipos_caso")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  revalidateTipos();
  return data;
}

export async function desativarTipoCaso(id: string) {
  return atualizarTipoCaso({ id, ativo: false });
}

export async function reativarTipoCaso(id: string) {
  return atualizarTipoCaso({ id, ativo: true });
}
