import "server-only";

import { sendText } from "@/lib/evogo/client";
import { salvarRespostaIA } from "@/lib/ia-whatsapp/ingest";

/**
 * IDs enviados pelo sistema nos últimos minutos. Se a EvoGo devolver o próprio
 * envio no webhook (IsFromMe), não confundimos com o advogado assumindo a conversa.
 */
const enviadosRecentes = new Map<string, number>();
const JANELA_MS = 10 * 60 * 1000;

export function foiEnviadoPeloSistema(messageId: string): boolean {
  const agora = Date.now();
  for (const [id, em] of enviadosRecentes) if (agora - em > JANELA_MS) enviadosRecentes.delete(id);
  return enviadosRecentes.has(messageId);
}

/** Envia texto ao cliente pela EvoGo e grava no painel como mensagem da IA. */
export async function enviarTextoCliente(params: {
  telefone: string;
  texto: string;
  instancia: string | null;
}): Promise<string> {
  const messageId = await sendText(params.telefone, params.texto);
  enviadosRecentes.set(messageId, Date.now());
  try {
    await salvarRespostaIA({ ...params, messageId });
  } catch (e) {
    console.error("[ia-whatsapp] mensagem enviada mas não gravada:", e);
  }
  return messageId;
}

/** Mensagem para o grupo/número do advogado (não entra no histórico do cliente). */
export async function enviarParaAdvogado(destino: string | null, texto: string): Promise<boolean> {
  if (!destino?.trim()) return false;
  try {
    const id = await sendText(destino.trim(), texto);
    enviadosRecentes.set(id, Date.now());
    return true;
  } catch (e) {
    console.error("[ia-whatsapp] falha ao avisar advogado:", e);
    return false;
  }
}

export function pausa(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
