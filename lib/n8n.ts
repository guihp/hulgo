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

/** Sandbox "Testar agente" → fluxo n8n Webhook → AI Agent → Respond to Webhook */
const DEFAULT_N8N_WEBHOOK_TESTE_IA =
  "https://n8n-sgo8ksokg404ocg8sgc4sooc.vemprajogo.com/webhook/teste-ia-hulgoo";

export type TesteIATipo = "texto" | "audio" | "imagem" | "documento";

export type TesteIAHistoricoTurn = {
  role: "user" | "assistant";
  content: string;
};

export type TesteIAWebhookPayload = {
  prompt: string;
  mensagem: string;
  tipo: TesteIATipo;
  audio_transcrito: string | null;
  imagem_descricao: string | null;
  documento_transcrito: string | null;
  historico: TesteIAHistoricoTurn[];
  sessao_id: string;
  versao_prompt: "rascunho" | "publicada";
  tipo_caso: string;
};

function getTesteIAWebhookUrl(): string {
  return (
    process.env.N8N_WEBHOOK_TESTE_IA?.trim() || DEFAULT_N8N_WEBHOOK_TESTE_IA
  );
}

/** Defensive extract of assistant text from Respond to Webhook body. */
export function extractN8nAgentReply(body: unknown): string {
  if (typeof body === "string") {
    const t = body.trim();
    if (t) return t;
  }
  if (!body || typeof body !== "object") {
    throw new Error("n8n retornou resposta vazia ou inválida");
  }

  const root = body as Record<string, unknown>;
  const candidates: unknown[] = [
    root.output,
    root.text,
    root.message,
    root.response,
    root.reply,
    root.result,
    root.data,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (c && typeof c === "object") {
      const nested = c as Record<string, unknown>;
      for (const key of ["output", "text", "message", "content", "response"]) {
        const v = nested[key];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
  }

  // LangChain / n8n AI Agent sometimes wraps as { data: [{ json: { output } }] }
  if (Array.isArray(root.data)) {
    for (const item of root.data) {
      if (!item || typeof item !== "object") continue;
      const json = (item as { json?: unknown }).json ?? item;
      try {
        return extractN8nAgentReply(json);
      } catch {
        /* try next */
      }
    }
  }

  throw new Error(
    "Não foi possível extrair o texto da resposta do n8n (esperado output/text/data)"
  );
}

/**
 * Chama o webhook do sandbox de teste da IA.
 * Env: N8N_WEBHOOK_TESTE_IA (default: webhook teste-ia-hulgoo).
 * Ver docs/TESTE-IA-N8N.md para mapear prompt/mensagem no AI Agent.
 */
export async function chamarWebhookTesteIA(
  payload: TesteIAWebhookPayload
): Promise<{ reply: string; model: string }> {
  const webhookUrl = getTesteIAWebhookUrl();

  let lastError = "Falha ao chamar webhook n8n";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const rawText = await res.text();
      let parsed: unknown = rawText;
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsed = rawText;
      }

      if (!res.ok) {
        const msg =
          typeof parsed === "object" &&
          parsed &&
          "message" in parsed &&
          typeof (parsed as { message: unknown }).message === "string"
            ? (parsed as { message: string }).message
            : `n8n HTTP ${res.status}`;
        lastError = msg;
      } else {
        const reply = extractN8nAgentReply(parsed);
        return { reply, model: "n8n" };
      }
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : lastError;
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }

  throw new Error(lastError);
}
