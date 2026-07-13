import "server-only";

/**
 * Controle da IA no n8n (block no Redis).
 * - "pausar": advogado assumiu a conversa → IA fica muda para o cliente.
 * - "despausar": libera a IA de volta (ex.: após aprovação enviada).
 * Fluxo n8n correspondente: docs/n8n-controle-ia.json
 * Env: N8N_WEBHOOK_CONTROLE_IA (fallback: N8N_WEBHOOK_APROVACAO).
 */
export type ControleIAResult = {
  configured: boolean;
  ok: boolean;
  error?: string;
};

export async function controlarIA(
  acao: "pausar" | "despausar",
  telefone: string,
  instancia: string | null | undefined,
  extra?: Record<string, unknown>
): Promise<ControleIAResult> {
  const webhookUrl =
    process.env.N8N_WEBHOOK_CONTROLE_IA || process.env.N8N_WEBHOOK_APROVACAO;
  if (!webhookUrl) return { configured: false, ok: false };

  const body = JSON.stringify({
    acao,
    telefone: telefone.replace(/@.*$/, "").replace(/\D/g, ""),
    instancia: instancia ?? null,
    origem: "sistema",
    ...extra,
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.ok) return { configured: true, ok: true };
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return { configured: true, ok: false, error: "Falha após 3 tentativas" };
}
