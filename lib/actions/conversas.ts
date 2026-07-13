"use server";

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
