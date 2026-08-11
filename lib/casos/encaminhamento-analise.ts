import { sendText } from "@/lib/evogo/client";
import { createServiceClient } from "@/lib/supabase/service";

/** Mensagem fixa ao entrar em `aguardando_analise` — não variar. */
export const MENSAGEM_ENCAMINHAMENTO_ANALISE =
  "Recebemos suas informações. Sua solicitação foi encaminhada para análise. Aguarde, que em breve retornaremos com a resposta.";

/**
 * Envia a mensagem fixa de encaminhamento se ainda não foi enviada
 * (`mensagem_encaminhamento_enviada_em` nulo). Usado pelo painel e pela
 * API de integração (n8n → kanban-mover).
 */
export async function enviarEncaminhamentoAnaliseSePendente(
  casoIds: number[]
): Promise<{ enviada: boolean; warning?: string }> {
  if (!casoIds.length) return { enviada: false };

  const supabase = createServiceClient();
  const { data: casos, error } = await supabase
    .from("casos_novos")
    .select("id, telefone, mensagem_encaminhamento_enviada_em")
    .in("id", casoIds)
    .is("mensagem_encaminhamento_enviada_em", null);

  if (error) {
    return { enviada: false, warning: error.message };
  }

  const caso = (casos ?? []).find((c) => {
    const digits = c.telefone?.replace(/\D/g, "") ?? "";
    return digits.length >= 10;
  });
  if (!caso?.telefone) return { enviada: false };

  const phoneDigits = caso.telefone.replace(/\D/g, "");

  try {
    await sendText(phoneDigits, MENSAGEM_ENCAMINHAMENTO_ANALISE);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Falha ao enviar WhatsApp";
    return { enviada: false, warning: msg };
  }

  const agora = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("casos_novos")
    .update({ mensagem_encaminhamento_enviada_em: agora })
    .in("id", casoIds)
    .is("mensagem_encaminhamento_enviada_em", null);

  if (updateError) {
    return {
      enviada: true,
      warning: `Mensagem enviada, mas falhou ao gravar flag: ${updateError.message}`,
    };
  }

  await supabase.from("app_log_eventos").insert({
    entidade: "casos_novos",
    entidade_id: caso.id,
    acao: "mensagem_encaminhamento_analise",
    payload: {
      telefone: phoneDigits,
      caso_ids: casoIds,
      texto: MENSAGEM_ENCAMINHAMENTO_ANALISE,
    },
  });

  return { enviada: true };
}
