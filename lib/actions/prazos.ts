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

  // Optional FKs: omit empty/0 so inserts without vínculo don't hit *_fkey.
  const cpfNorm = input.cpf?.trim() ? normalizeCpf(input.cpf) : null;
  const casoId =
    typeof input.caso_id === "number" && input.caso_id > 0
      ? input.caso_id
      : null;
  const processoId =
    typeof input.processo_id === "number" && input.processo_id > 0
      ? input.processo_id
      : null;

  const supabase = await createClient();
  const { error } = await supabase.from("app_prazos").insert({
    titulo: input.titulo.trim(),
    tipo: input.tipo,
    data_prazo: input.data_prazo,
    descricao: input.descricao?.trim() || null,
    cpf: cpfNorm || null,
    caso_id: casoId,
    processo_id: processoId,
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
