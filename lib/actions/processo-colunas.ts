"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import {
  listProcessoColunas,
  processoColunaRowToMatch,
  type ProcessoColunaMatch,
} from "@/lib/data/processo-colunas";
import {
  isCorColunaProcesso,
  isFunilProcesso,
  type FunilProcesso,
} from "@/lib/utils/processos";

export type { ProcessoColunaMatch };

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

function assertFunil(funil: string): FunilProcesso {
  if (!isFunilProcesso(funil)) throw new Error(`Funil inválido: ${funil}`);
  return funil;
}

function normalizeCor(cor: string | null | undefined): string | null {
  if (cor === null || cor === undefined || cor === "") return null;
  if (!isCorColunaProcesso(cor)) throw new Error(`Cor inválida: ${cor}`);
  return cor;
}

async function requireAdvogado() {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (user.papel !== "advogado") {
    throw new Error("Apenas advogados podem gerenciar colunas do funil");
  }
  return user;
}

function revalidateProcessos() {
  revalidatePath("/processos");
  revalidatePath("/configuracoes");
  revalidatePath("/clientes", "layout");
}

export async function listarProcessoColunasAction(
  funil: FunilProcesso,
  includeInactive = false
) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  return listProcessoColunas(assertFunil(funil), { includeInactive });
}

export type CriarProcessoColunaInput = {
  funil: FunilProcesso;
  label: string;
  chave?: string;
  ordem?: number;
  cor?: string | null;
};

export async function criarProcessoColuna(
  input: CriarProcessoColunaInput
): Promise<ProcessoColunaMatch> {
  await requireAdvogado();
  const funil = assertFunil(input.funil);

  const label = input.label.trim();
  if (!label) throw new Error("Nome da coluna é obrigatório");

  const chave = slugifyChave(input.chave?.trim() || label);
  if (!chave) throw new Error("Chave inválida");

  const supabase = await createClient();
  const { data: maxOrdem } = await supabase
    .from("app_processo_colunas")
    .select("ordem")
    .eq("funil", funil)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ordem = input.ordem ?? (maxOrdem?.ordem ?? 0) + 10;

  const { data, error } = await supabase
    .from("app_processo_colunas")
    .insert({
      funil,
      chave,
      label,
      ordem,
      ativo: true,
      cor: normalizeCor(input.cor),
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(`Já existe uma coluna com a chave "${chave}" neste funil`);
    }
    throw new Error(error.message);
  }

  revalidateProcessos();
  return processoColunaRowToMatch(data);
}

export type AtualizarProcessoColunaInput = {
  id: string;
  label?: string;
  ordem?: number;
  ativo?: boolean;
  cor?: string | null;
};

export async function atualizarProcessoColuna(
  input: AtualizarProcessoColunaInput
): Promise<ProcessoColunaMatch> {
  await requireAdvogado();

  const supabase = await createClient();
  const { data: existing, error: findErr } = await supabase
    .from("app_processo_colunas")
    .select("*")
    .eq("id", input.id)
    .maybeSingle();

  if (findErr) throw new Error(findErr.message);
  if (!existing) throw new Error("Coluna não encontrada");

  const patch: {
    label?: string;
    ordem?: number;
    ativo?: boolean;
    cor?: string | null;
    updated_at: string;
  } = { updated_at: new Date().toISOString() };

  if (input.label !== undefined) {
    const label = input.label.trim();
    if (!label) throw new Error("Nome da coluna é obrigatório");
    patch.label = label;
  }
  if (input.ordem !== undefined) patch.ordem = input.ordem;
  if (input.cor !== undefined) patch.cor = normalizeCor(input.cor);
  if (input.ativo !== undefined) {
    if (input.ativo === false && existing.ativo) {
      const { count } = await supabase
        .from("app_processo_colunas")
        .select("id", { count: "exact", head: true })
        .eq("funil", existing.funil)
        .eq("ativo", true);
      if ((count ?? 0) <= 1) {
        throw new Error("O funil precisa de ao menos uma coluna ativa");
      }
    }
    patch.ativo = input.ativo;
  }

  const { data, error } = await supabase
    .from("app_processo_colunas")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  revalidateProcessos();
  return processoColunaRowToMatch(data);
}

export async function renomearProcessoColuna(id: string, label: string) {
  return atualizarProcessoColuna({ id, label });
}

/** Arquiva a coluna (não apaga — processos mantêm a chave até serem movidos). */
export async function arquivarProcessoColuna(id: string) {
  return atualizarProcessoColuna({ id, ativo: false });
}

export async function reativarProcessoColuna(id: string) {
  return atualizarProcessoColuna({ id, ativo: true });
}

export async function reordenarProcessoColunas(
  funil: FunilProcesso,
  orderedIds: string[]
): Promise<ProcessoColunaMatch[]> {
  await requireAdvogado();
  const f = assertFunil(funil);
  if (!orderedIds.length) throw new Error("Lista vazia");

  const supabase = await createClient();
  const now = new Date().toISOString();

  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("app_processo_colunas")
        .update({ ordem: (index + 1) * 10, updated_at: now })
        .eq("id", id)
        .eq("funil", f)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  revalidateProcessos();
  return listProcessoColunas(f, { includeInactive: true });
}
