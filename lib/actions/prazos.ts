"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import { normalizeCpf } from "@/lib/utils/cpf";
import type { PrazoTipo } from "@/types/database";

export type NovoPrazoInput = {
  titulo: string;
  tipo: PrazoTipo;
  data_prazo: string; // yyyy-mm-dd
  descricao?: string;
  cpf?: string;
  caso_id?: number;
  processo_id?: number;
};

function revalidatePrazos() {
  revalidatePath("/prazos");
  revalidatePath("/");
}

export async function criarPrazo(input: NovoPrazoInput) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  if (!input.titulo.trim()) throw new Error("Título é obrigatório");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data_prazo)) {
    throw new Error("Data do prazo inválida");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("app_prazos").insert({
    titulo: input.titulo.trim(),
    tipo: input.tipo,
    data_prazo: input.data_prazo,
    descricao: input.descricao?.trim() || null,
    cpf: input.cpf ? normalizeCpf(input.cpf) : null,
    caso_id: input.caso_id ?? null,
    processo_id: input.processo_id ?? null,
    criado_por: user.id,
  });

  if (error) throw new Error(error.message);
  revalidatePrazos();
  return { success: true };
}

export async function concluirPrazo(id: number, concluido: boolean) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_prazos")
    .update({
      concluido,
      concluido_em: concluido ? new Date().toISOString() : null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePrazos();
  return { success: true };
}

export async function excluirPrazo(id: number) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const supabase = await createClient();
  const { error } = await supabase.from("app_prazos").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePrazos();
  return { success: true };
}
