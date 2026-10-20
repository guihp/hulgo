"use server";

import { getAppUser } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { ETIQUETA_CORES, ETIQUETA_NOME_MAX } from "@/lib/utils/etiquetas";

async function exigirUsuario() {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
}

function validar(nome: string, cor: string) {
  const limpo = nome.trim().replace(/\s+/g, " ");
  if (!limpo) throw new Error("Dê um nome para a etiqueta");
  if (limpo.length > ETIQUETA_NOME_MAX) {
    throw new Error(`O nome pode ter até ${ETIQUETA_NOME_MAX} caracteres`);
  }
  if (!(cor in ETIQUETA_CORES)) throw new Error("Cor inválida");
  return limpo;
}

function erroAmigavel(message: string): Error {
  if (/app_etiquetas_nome_key|duplicate key/i.test(message)) {
    return new Error("Já existe uma etiqueta com esse nome");
  }
  return new Error(message);
}

export async function criarEtiqueta(input: { nome: string; cor: string }) {
  await exigirUsuario();
  const nome = validar(input.nome, input.cor);
  const supabase = await createClient();
  const { data: ultima } = await supabase
    .from("app_etiquetas")
    .select("ordem")
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("app_etiquetas")
    .insert({ nome, cor: input.cor, ordem: (ultima?.ordem ?? 0) + 1 })
    .select("*")
    .single();
  if (error) throw erroAmigavel(error.message);
  return data;
}

export async function editarEtiqueta(input: { id: number; nome: string; cor: string }) {
  await exigirUsuario();
  const nome = validar(input.nome, input.cor);
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_etiquetas")
    .update({ nome, cor: input.cor })
    .eq("id", input.id);
  if (error) throw erroAmigavel(error.message);
  return { success: true as const };
}

/** Apaga a etiqueta e a tira de todas as conversas (ON DELETE CASCADE). */
export async function excluirEtiqueta(id: number) {
  await exigirUsuario();
  const supabase = await createClient();
  const { error } = await supabase.from("app_etiquetas").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true as const };
}

export async function definirEtiquetaConversa(input: {
  contactNorm: string;
  etiquetaId: number;
  marcada: boolean;
}) {
  await exigirUsuario();
  const supabase = await createClient();
  const { error } = input.marcada
    ? await supabase
        .from("app_conversa_etiquetas")
        .upsert(
          { contact_norm: input.contactNorm, etiqueta_id: input.etiquetaId },
          { onConflict: "contact_norm,etiqueta_id", ignoreDuplicates: true }
        )
    : await supabase
        .from("app_conversa_etiquetas")
        .delete()
        .eq("contact_norm", input.contactNorm)
        .eq("etiqueta_id", input.etiquetaId);
  if (error) throw new Error(error.message);
  return { success: true as const };
}
