export type AssistenteToolResult = {
  ok: boolean;
  summary: string;
  links?: { label: string; href: string }[];
  data?: unknown;
  /** Write tool proposed; waiting for UI confirmation before execute. */
  requiresConfirmation?: boolean;
  confirmationId?: string;
  /** Short label for the confirm card. */
  confirmationLabel?: string;
};

/** One Antes/Depois block in a prompt-edit confirmation card. */
export type AssistentePromptEditPreviewItem = {
  documento: "persona" | "mensagem_abertura";
  before: string;
  after: string;
  modo: string;
  secao: string | null;
  linha: number | null;
  motivo?: string;
};

/** Rich preview for prompt-edit confirmation cards (also nested under data). */
export type AssistentePromptEditPreview = {
  before: string;
  after: string;
  modo: string;
  secao: string | null;
  linha: number | null;
  /** Batch package — prefer this when present (N blocks). */
  alteracoes?: AssistentePromptEditPreviewItem[];
};

export type AssistenteSessaoListItem = {
  id: string;
  created_at: string;
  updated_at: string;
  preview: string;
  message_count: number;
};

export type AssistenteConfirmationStatus =
  | "pending"
  | "confirmed"
  | "cancelled";

export type AssistenteToolTraceItem = {
  name: string;
  args: Record<string, unknown>;
  result: AssistenteToolResult;
  confirmationId?: string;
  confirmationStatus?: AssistenteConfirmationStatus;
};

/** How the user wants the assistant to handle an attached file. */
export type AssistenteAnexoModo = "interpretar" | "somente_salvar";

export type AssistenteAnexoKind = "image" | "video" | "audio" | "documento";

/** Persisted on app_assistente_mensagens.anexos (no base64). */
export type AssistenteAnexoStored = {
  kind: AssistenteAnexoKind;
  modo: AssistenteAnexoModo;
  fileName: string;
  mimeType: string;
  url?: string | null;
  /** Vision/whisper/doc extract when modo=interpretar; null for save-only. */
  transcript?: string | null;
};

/**
 * Pending attachment on app_assistente_sessoes.pending_anexo.
 * Survives follow-up turns until anexado, replaced, or session cleared.
 */
export type AssistentePendingAnexo = {
  url_media: string;
  mime: string;
  nome_arquivo: string;
  modo: AssistenteAnexoModo;
  kind: AssistenteAnexoKind;
};

/** Payload from the drawer composer (base64 stripped after upload). */
export type AssistenteAnexoInput = {
  kind: AssistenteAnexoKind;
  modo: AssistenteAnexoModo;
  base64: string;
  mimeType: string;
  fileName: string;
};

export type AssistenteMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_trace: AssistenteToolTraceItem[];
  anexos?: AssistenteAnexoStored[];
  created_at: string;
};

export type AssistenteSessionResult = {
  sessaoId: string;
  messages: AssistenteMessage[];
  /** OpenAI chat model label (OPENAI_MODEL or default). */
  model?: string;
};

export type AssistenteSendResult = {
  sessaoId: string;
  userMessage: AssistenteMessage;
  assistantMessage: AssistenteMessage;
  model: string;
};

export type AssistenteConfirmResult = {
  sessaoId: string;
  updatedMessage: AssistenteMessage;
  /** Only when there is something beyond the result card (e.g. ask for a corrected CPF). */
  followUpMessage: AssistenteMessage | null;
};
