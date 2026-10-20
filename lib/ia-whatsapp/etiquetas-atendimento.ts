import "server-only";

import { normalizarTelefone } from "@/lib/ia-whatsapp/config";
import { createServiceClient } from "@/lib/supabase/service";

export const CHAVE_IA_ATENDENDO = "ia_atendendo";
export const CHAVE_ATENDIMENTO_HUMANO = "atendimento_humano";
export const CHAVES_ATENDIMENTO = [CHAVE_IA_ATENDENDO, CHAVE_ATENDIMENTO_HUMANO] as const;

/**
 * Troca a etiqueta automática de quem está atendendo a conversa:
 * "ia" → IA atendendo · "humano" → Atendimento humano · null → nenhuma.
 * Só escreve quando muda (o webhook chama a cada mensagem do escritório).
 * Nunca lança: etiqueta não pode quebrar o atendimento.
 */
export async function marcarAtendimento(
  telefone: string,
  quem: "ia" | "humano" | null
): Promise<void> {
  const contato = normalizarTelefone(telefone);
  if (!contato) return;
  const supabase = createServiceClient();
  try {
    const { data: sistema } = await supabase
      .from("app_etiquetas")
      .select("id, chave")
      .in("chave", [...CHAVES_ATENDIMENTO]);
    const idIa = sistema?.find((e) => e.chave === CHAVE_IA_ATENDENDO)?.id;
    const idHumano = sistema?.find((e) => e.chave === CHAVE_ATENDIMENTO_HUMANO)?.id;
    const ids = [idIa, idHumano].filter((id): id is number => id != null);
    if (!ids.length) return;

    const alvo = quem === "ia" ? idIa : quem === "humano" ? idHumano : undefined;
    const { data: atuais } = await supabase
      .from("app_conversa_etiquetas")
      .select("etiqueta_id")
      .eq("contact_norm", contato)
      .in("etiqueta_id", ids);
    const tem = new Set((atuais ?? []).map((r) => r.etiqueta_id));

    const remover = ids.filter((id) => id !== alvo && tem.has(id));
    if (remover.length) {
      await supabase
        .from("app_conversa_etiquetas")
        .delete()
        .eq("contact_norm", contato)
        .in("etiqueta_id", remover);
    }
    if (alvo != null && !tem.has(alvo)) {
      await supabase
        .from("app_conversa_etiquetas")
        .upsert(
          { contact_norm: contato, etiqueta_id: alvo },
          { onConflict: "contact_norm,etiqueta_id", ignoreDuplicates: true }
        );
    }
  } catch (e) {
    console.warn("[etiquetas-atendimento]", contato, e instanceof Error ? e.message : e);
  }
}
