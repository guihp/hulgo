"use server";

import { getAppUser } from "@/lib/actions/auth";
import { controlarIA } from "@/lib/n8n";
import { createClient } from "@/lib/supabase/server";

/** Marca a conversa como lida para o usuário atual (badge estilo WhatsApp). */
export async function marcarConversaLida(contactNorm: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado");

  const { error } = await supabase.from("app_conversas_lidas").upsert(
    {
      user_id: user.id,
      contact_norm: contactNorm,
      lida_em: new Date().toISOString(),
    },
    { onConflict: "user_id,contact_norm" }
  );
  if (error) throw new Error(error.message);
  return { success: true };
}

/** Pausa ou despausa a IA na conversa (webhook n8n / Redis block). */
export async function setControleIA(input: {
  acao: "pausar" | "despausar";
  telefone: string;
  instancia?: string | null;
}) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const result = await controlarIA(
    input.acao,
    input.telefone,
    input.instancia
  );
  if (!result.configured) {
    throw new Error("Webhook de controle da IA não configurado");
  }
  if (!result.ok) {
    throw new Error(result.error ?? "Falha ao controlar a IA");
  }
  return { success: true as const };
}
