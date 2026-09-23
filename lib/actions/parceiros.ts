"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import { normalizeParceiroTelefone } from "@/lib/utils/phone";

export type Parceiro = {
  id: string;
  nome: string;
  cidade: string;
  telefone: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

async function requireAdvogado() {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (user.papel !== "advogado") {
    throw new Error("Apenas advogados podem gerenciar parceiros");
  }
  return user;
}

function revalidateParceiros() {
  revalidatePath("/configuracoes");
}

/** Lista parceiros para selects (qualquer usuário autenticado). */
export async function listParceiros(): Promise<Parceiro[]> {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_parceiros")
    .select("*")
    .order("nome", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Parceiro[];
}

export type CriarParceiroInput = {
  nome: string;
  cidade?: string;
  telefone: string;
};

export async function criarParceiro(
  input: CriarParceiroInput
): Promise<Parceiro> {
  const user = await requireAdvogado();

  const nome = input.nome.trim();
  if (!nome) throw new Error("Nome do parceiro é obrigatório");

  const cidade = (input.cidade ?? "").trim();
  const telefone = normalizeParceiroTelefone(input.telefone);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_parceiros")
    .insert({
      nome,
      cidade,
      telefone,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  revalidateParceiros();
  return data as Parceiro;
}

export type AtualizarParceiroInput = {
  id: string;
  nome?: string;
  cidade?: string;
  telefone?: string;
};

export async function atualizarParceiro(
  input: AtualizarParceiroInput
): Promise<Parceiro> {
  await requireAdvogado();
  if (!input.id) throw new Error("id é obrigatório");

  const patch: {
    updated_at: string;
    nome?: string;
    cidade?: string;
    telefone?: string;
  } = {
    updated_at: new Date().toISOString(),
  };

  if (input.nome !== undefined) {
    const nome = input.nome.trim();
    if (!nome) throw new Error("Nome do parceiro é obrigatório");
    patch.nome = nome;
  }
  if (input.cidade !== undefined) {
    patch.cidade = input.cidade.trim();
  }
  if (input.telefone !== undefined) {
    patch.telefone = normalizeParceiroTelefone(input.telefone);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_parceiros")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  revalidateParceiros();
  return data as Parceiro;
}

export async function excluirParceiro(id: string): Promise<void> {
  await requireAdvogado();
  if (!id) throw new Error("id é obrigatório");

  const supabase = await createClient();
  const { error } = await supabase.from("app_parceiros").delete().eq("id", id);

  if (error) throw new Error(error.message);
  revalidateParceiros();
}
