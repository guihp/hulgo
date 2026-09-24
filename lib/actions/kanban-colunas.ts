"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import {
  listKanbanColunas,
  type KanbanColunaMatch,
} from "@/lib/data/kanban-colunas";
import { CASO_STATUS } from "@/lib/constants";

export type { KanbanColunaMatch };

const SYSTEM_CHAVES = new Set(CASO_STATUS.map((s) => s.value));

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

async function requireAdvogado() {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (user.papel !== "advogado") {
    throw new Error("Apenas advogados podem gerenciar colunas do funil");
  }
  return user;
}

function revalidateKanban() {
  revalidatePath("/kanban");
  revalidatePath("/configuracoes");
  revalidatePath("/");
}

export async function listarKanbanColunasAction(includeInactive = false) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  return listKanbanColunas({ includeInactive });
}

export type CriarKanbanColunaInput = {
  label: string;
  chave?: string;
  ordem?: number;
};

export async function criarKanbanColuna(input: CriarKanbanColunaInput) {
  await requireAdvogado();

  const label = input.label.trim();
  if (!label) throw new Error("Nome da coluna é obrigatório");

  let chave = slugifyChave(input.chave?.trim() || label);
  if (!chave) throw new Error("Chave inválida");
  if (SYSTEM_CHAVES.has(chave)) {
    throw new Error(
      `A chave "${chave}" é reservada pelo sistema. Escolha outro nome.`
    );
  }
  // Prefixo para evitar colisão futura com chaves de sistema
  if (!chave.startsWith("custom_") && !chave.startsWith("col_")) {
    chave = `custom_${chave}`;
  }

  const supabase = await createClient();
  const { data: maxOrdem } = await supabase
    .from("app_kanban_colunas")
    .select("ordem")
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Inserir antes de "processo_finalizado" quando possível
  const ordem =
    input.ordem ??
    Math.min((maxOrdem?.ordem ?? 80) + 5, 85);

  const { data, error } = await supabase
    .from("app_kanban_colunas")
    .insert({
      chave,
      label,
      ordem,
      ativo: true,
      is_system: false,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(`Já existe uma coluna com a chave "${chave}"`);
    }
    throw new Error(error.message);
  }

  revalidateKanban();
  return {
    id: data.id,
    chave: data.chave,
    label: data.label,
    ordem: data.ordem,
    ativo: data.ativo,
    is_system: data.is_system,
  } satisfies KanbanColunaMatch;
}

export type AtualizarKanbanColunaInput = {
  id: string;
  label?: string;
  ordem?: number;
  ativo?: boolean;
};

export async function atualizarKanbanColuna(input: AtualizarKanbanColunaInput) {
  await requireAdvogado();

  const supabase = await createClient();
  const { data: existing, error: findErr } = await supabase
    .from("app_kanban_colunas")
    .select("*")
    .eq("id", input.id)
    .maybeSingle();

  if (findErr) throw new Error(findErr.message);
  if (!existing) throw new Error("Coluna não encontrada");

  const patch: {
    label?: string;
    ordem?: number;
    ativo?: boolean;
    updated_at: string;
  } = { updated_at: new Date().toISOString() };

  if (input.label !== undefined) {
    const label = input.label.trim();
    if (!label) throw new Error("Nome da coluna é obrigatório");
    patch.label = label;
  }
  if (input.ordem !== undefined) patch.ordem = input.ordem;
  if (input.ativo !== undefined) {
    if (existing.is_system && input.ativo === false) {
      throw new Error("Colunas do sistema não podem ser arquivadas");
    }
    patch.ativo = input.ativo;
  }

  const { data, error } = await supabase
    .from("app_kanban_colunas")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  revalidateKanban();
  return {
    id: data.id,
    chave: data.chave,
    label: data.label,
    ordem: data.ordem,
    ativo: data.ativo,
    is_system: data.is_system,
  } satisfies KanbanColunaMatch;
}

/** Arquiva coluna personalizada (não apaga — cards mantêm o status). */
export async function arquivarKanbanColuna(id: string) {
  return atualizarKanbanColuna({ id, ativo: false });
}

export async function reativarKanbanColuna(id: string) {
  return atualizarKanbanColuna({ id, ativo: true });
}

export async function reordenarKanbanColunas(
  orderedIds: string[]
): Promise<KanbanColunaMatch[]> {
  await requireAdvogado();
  if (!orderedIds.length) throw new Error("Lista vazia");

  const supabase = await createClient();
  const now = new Date().toISOString();

  await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("app_kanban_colunas")
        .update({ ordem: (index + 1) * 10, updated_at: now })
        .eq("id", id)
    )
  );

  revalidateKanban();
  return listKanbanColunas({ includeInactive: true });
}
