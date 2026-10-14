import "server-only";

import type { IaWhatsappConfig } from "@/lib/ia-whatsapp/config";
import { enviarParaAdvogado, enviarTextoCliente } from "@/lib/ia-whatsapp/enviar";
import { despausarIA, pausarIA } from "@/lib/ia-whatsapp/estado";
import type { MensagemRecebida } from "@/lib/ia-whatsapp/evogo-payload";
import { createServiceClient } from "@/lib/supabase/service";

const AJUDA =
  "Comando não reconhecido. Use:\n✅ #aprovar <id>\n✏️ #responder <id> <texto>\n❌ #recusar <id>";

type Acao = "aprovar" | "responder" | "recusar";

export function ehComandoAdvogado(texto: string): boolean {
  return texto.trim().startsWith("#");
}

/**
 * Comandos no grupo do advogado (port do ramo "APROVAÇÃO DO ADVOGADO" do n8n).
 * Mesma decisão da tela /aprovacoes: envia ao cliente pelo sistema e grava a trilha.
 */
export async function tratarComandoAdvogado(
  msg: MensagemRecebida,
  config: IaWhatsappConfig
): Promise<void> {
  const grupo = config.grupo_advogado;
  const m = msg.texto.trim().match(/^#(aprovar|responder|recusar)\s+(\d+)\s*([\s\S]*)$/i);
  const acao = m?.[1].toLowerCase() as Acao | undefined;
  const texto = (m?.[3] ?? "").trim();
  if (!m || !acao || (acao === "responder" && !texto)) {
    await enviarParaAdvogado(grupo, AJUDA);
    return;
  }
  const id = Number(m[2]);

  const supabase = createServiceClient();
  const { data: p } = await supabase
    .from("aprovacoes_pendentes")
    .select("*")
    .eq("id", id)
    .eq("status", "pendente")
    .maybeSingle();
  if (!p) {
    await enviarParaAdvogado(grupo, `Pendência #${id} não encontrada ou já processada.`);
    return;
  }

  const telefone = p.telefone_cliente.replace(/@.*$/, "").replace(/\D/g, "");
  const envio = acao === "aprovar" ? p.resumo : acao === "responder" ? texto : "";
  let messageId: string | null = null;
  if (envio) {
    messageId = await enviarTextoCliente({ telefone, texto: envio, instancia: p.instancia });
  }

  const status =
    acao === "aprovar" ? "aprovado" : acao === "responder" ? "respondido_manual" : "recusado";
  await supabase
    .from("aprovacoes_pendentes")
    .update({
      status,
      resumo_final: acao === "aprovar" ? envio : null,
      resposta_manual: acao === "responder" ? envio : null,
      decidido_em: new Date().toISOString(),
      enviado_whatsapp: Boolean(messageId),
      mensagem_id: messageId,
    })
    .eq("id", id);

  if (acao === "recusar") await pausarIA(telefone, "aprovacao_recusada");
  else await despausarIA(telefone);

  await supabase.from("app_log_eventos").insert({
    entidade: "aprovacoes_pendentes",
    entidade_id: id,
    acao: "decisao",
    payload: { acao, status, origem: "whatsapp", advogado: msg.remetente, message_id: messageId },
  });

  const nome = p.nome_cliente ?? telefone;
  await enviarParaAdvogado(
    grupo,
    acao === "recusar"
      ? `❌ Pendência #${id} recusada. O cliente segue PAUSADO para a IA — responda a ele manualmente.`
      : `✅ Pendência #${id} enviada ao cliente ${nome}. IA reativada para ele.`
  );
}
