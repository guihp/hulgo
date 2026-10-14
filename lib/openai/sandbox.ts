/**
 * OpenAI helpers for the agent sandbox (server-only).
 * Used only for media preprocessing (Whisper / vision / doc extract).
 * Final agent replies come from n8n — see lib/n8n.ts chamarWebhookTesteIA.
 * Uses fetch — no SDK dependency.
 */

import {
  detectarFormatoDocumento,
  extrairTextoDocumento,
} from "@/lib/documentos/extrair-texto";
import { imagemParaVisao } from "@/lib/openai/imagem";

const OPENAI_BASE ="https://api.openai.com/v1";

export function getOpenAIApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY não configurada. Adicione no .env.local e reinicie o servidor."
    );
  }
  return key;
}

/** Multimodal model for vision / doc describe. Override with OPENAI_MODEL. */
export function getOpenAIChatModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5.6-luna";
}

/** Whisper model for audio transcription. Override with OPENAI_TRANSCRIBE_MODEL. */
export function getOpenAITranscribeModel(): string {
  return process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || "whisper-1";
}

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

export async function openaiChatCompletions(messages: ChatMessage[]): Promise<string> {
  const apiKey = getOpenAIApiKey();
  const model = getOpenAIChatModel();

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
    }),
  });

  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: { message?: { content?: string | null } }[];
  } | null;

  if (!res.ok) {
    const msg = body?.error?.message || `OpenAI HTTP ${res.status}`;
    throw new Error(msg);
  }

  const content = body?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) {
    throw new Error("OpenAI retornou resposta vazia");
  }
  return content;
}

/** Full visual description for the n8n agent (primary image content). */
export async function openaiDescribeImage(input: {
  dataUrl: string;
  caption?: string;
}): Promise<string> {
  const caption = (input.caption ?? "").trim();
  return openaiChatCompletions([
    {
      role: "system",
      content:
        "Descreva a imagem de forma completa e objetiva em português, incluindo todo texto legível. " +
        "Não responda ao cliente — só descreva o que vê. Seja detalhado o bastante para um agente de atendimento agir sem ver a imagem. " +
        "Se for documento (RG, CNH, CPF, certidão, comprovante de residência, carteira de pescador etc.), diga o tipo e transcreva " +
        "LITERALMENTE cada campo legível, um por linha (\"Campo: valor\"): nome, nº do RG/registro, órgão expedidor e UF, data de expedição, " +
        "CPF, data e local de nascimento (naturalidade), filiação, estado civil, e endereço completo (rua, número, bairro, município, UF, CEP). " +
        "Liste só os campos que existem no documento; não invente. Campo presente mas impossível de ler = \"ilegível\".",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: caption
            ? `Legenda do cliente: ${caption}\n\nDescreva a imagem.`
            : "Descreva a imagem enviada pelo cliente.",
        },
        { type: "image_url", image_url: { url: input.dataUrl } },
      ],
    },
  ]);
}

/**
 * Extract / describe document text for the n8n agent.
 * Text files and PDF/Office/ODF are decoded locally; images use vision;
 * scanned PDFs go to the model as a file; legacy binaries get a
 * best-effort printable extract + model cleanup.
 */
export async function openaiExtractDocumentText(input: {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<string> {
  const mime = (input.mimeType || "").toLowerCase();
  const name = (input.fileName || "documento").toLowerCase();

  if (
    mime.startsWith("text/") ||
    /\.(txt|md|csv|json|html?)$/i.test(name)
  ) {
    const text = input.bytes.toString("utf8").trim();
    if (!text) throw new Error("Documento de texto vazio");
    return text.slice(0, 80_000);
  }

  if (mime.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp|hei[cf])$/i.test(name)) {
    const dataUrl = await imagemParaVisao(input);
    return openaiDescribeImage({
      dataUrl,
      caption: `Documento: ${input.fileName}`,
    });
  }

  // PDF/DOCX/XLSX/PPTX/ODF: leitura estruturada local (tabelas viram "a | b | c").
  const formato = detectarFormatoDocumento(input.bytes, name, mime);
  if (formato) {
    let extraido: string | null = null;
    try {
      extraido = await extrairTextoDocumento(input);
    } catch (e) {
      console.warn("[extrairTextoDocumento]", input.fileName, e);
    }
    if (extraido) return extraido;
    // PDF sem camada de texto (digitalizado): o modelo lê as páginas como imagem.
    if (formato === "pdf") {
      return openaiChatCompletions([
        {
          role: "system",
          content:
            "Transcreva em português todo o texto legível deste PDF, preservando a ordem. " +
            "Tabelas: uma linha por registro, colunas separadas por \" | \". Não invente; campo ilegível = \"ilegível\".",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Arquivo: ${input.fileName}` },
            {
              type: "file",
              file: {
                filename: input.fileName || "documento.pdf",
                file_data: `data:application/pdf;base64,${input.bytes.toString("base64")}`,
              },
            },
          ],
        },
      ]);
    }
    throw new Error(
      "Não foi possível ler o texto deste documento. Envie em PDF, imagem ou .txt."
    );
  }

  // Formatos antigos (.doc/.xls/.rtf): best-effort com trechos imprimíveis.
  const latin = input.bytes.toString("latin1");
  const printable = latin
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40_000);

  if (printable.length < 40) {
    throw new Error(
      "Não foi possível extrair texto deste documento. Envie PDF com texto, imagem ou .txt."
    );
  }

  return openaiChatCompletions([
    {
      role: "system",
      content:
        "Você recebe trechos brutos extraídos de um arquivo (PDF/DOC etc.). " +
        "Reconstrua o texto útil em português, removendo ruído. Não invente conteúdo ausente. " +
        "Responda só com o texto do documento.",
    },
    {
      role: "user",
      content: `Arquivo: ${input.fileName} (${input.mimeType})\n\nTrechos:\n${printable}`,
    },
  ]);
}

export async function openaiTranscribeAudio(input: {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<string> {
  const apiKey = getOpenAIApiKey();
  const model = getOpenAITranscribeModel();

  const form = new FormData();
  form.append("model", model);
  form.append("language", "pt");
  const blob = new Blob([new Uint8Array(input.bytes)], {
    type: input.mimeType || "application/octet-stream",
  });
  form.append("file", blob, input.fileName || "audio.webm");

  const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    text?: string;
  } | null;

  if (!res.ok) {
    const msg = body?.error?.message || `Whisper HTTP ${res.status}`;
    throw new Error(msg);
  }

  const text = body?.text?.trim() ?? "";
  if (!text) {
    throw new Error("Não foi possível transcrever o áudio");
  }
  return text;
}
