"use server";

import { getAppUser } from "@/lib/actions/auth";
import { after } from "next/server";
import { getIaConfig, iaAtendeTelefone, normalizarTelefone } from "@/lib/ia-whatsapp/config";
import { retomarAtendimentoIA } from "@/lib/ia-whatsapp/processar";
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
      nao_lida: false,
    },
    { onConflict: "user_id,contact_norm" }
  );
  if (error) throw new Error(error.message);
  return { success: true };
}

/** "Marcar como não lida": mantém o lida_em e acende o badge até abrir de novo. */
export async function marcarConversaNaoLida(contactNorm: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado");

  const { error } = await supabase.from("app_conversas_lidas").upsert(
    { user_id: user.id, contact_norm: contactNorm, nao_lida: true },
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
  /** despausar: a IA manda já uma mensagem continuando (senão espera o cliente escrever). */
  responderAgora?: boolean;
}) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const responderAgora = input.acao === "despausar" && input.responderAgora === true;
  if (responderAgora && !iaAtendeTelefone(await getIaConfig(), normalizarTelefone(input.telefone))) {
    throw new Error(
      "A IA não atende este contato agora (desligada ou em modo teste). Ligue a IA em IA do WhatsApp."
    );
  }

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
  if (responderAgora) {
    const telefone = normalizarTelefone(input.telefone);
    after(() =>
      retomarAtendimentoIA(telefone, input.instancia ?? null).catch((e) =>
        console.error("[ia-whatsapp] retomar", telefone, e)
      )
    );
  }
  return { success: true as const };
}
