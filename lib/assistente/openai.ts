/**
 * OpenAI Responses API with tool-calling for the internal assistant.
 * Uses /v1/responses (not chat/completions) so gpt-5.6-luna can use function tools
 * with reasoning. Uses fetch (no SDK). Omits temperature — some models reject it.
 */

import {
  getOpenAIApiKey,
  getOpenAIChatModel,
} from "@/lib/openai/sandbox";
import {
  ASSISTENTE_TOOL_DEFINITIONS,
  executeAssistenteTool,
} from "@/lib/assistente/tools";
import type {
  AssistentePendingAnexo,
  AssistenteToolResult,
  AssistenteToolTraceItem,
} from "@/lib/assistente/types";

const OPENAI_BASE = "https://api.openai.com/v1";
const MAX_TOOL_ROUNDS = 6;

/** Chat-completions-style defs → Responses API flat function tools. */
type ChatStyleToolDef = (typeof ASSISTENTE_TOOL_DEFINITIONS)[number];

type ResponsesFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: ChatStyleToolDef["function"]["parameters"];
};

function toResponsesTools(
  defs: readonly ChatStyleToolDef[]
): ResponsesFunctionTool[] {
  return defs.map((d) => ({
    type: "function" as const,
    name: d.function.name,
    description: d.function.description,
    parameters: d.function.parameters,
  }));
}

type ResponsesInputItem =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

type ResponsesFunctionCall = {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
};

type ResponsesOutputItem =
  | ResponsesFunctionCall
  | {
      type: "message";
      role?: string;
      content?: Array<{ type?: string; text?: string } | string> | string;
    }
  | { type: string; [key: string]: unknown };

type ResponsesApiBody = {
  error?: { message?: string };
  id?: string;
  output?: ResponsesOutputItem[];
  output_text?: string;
};

function extractOutputText(body: ResponsesApiBody): string {
  if (typeof body.output_text === "string" && body.output_text.trim()) {
    return body.output_text.trim();
  }

  const parts: string[] = [];
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    const content = (item as { content?: unknown }).content;
    if (typeof content === "string") {
      if (content.trim()) parts.push(content.trim());
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part === "string") {
        if (part.trim()) parts.push(part.trim());
        continue;
      }
      if (
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        const text = (part as { text: string }).text.trim();
        if (text) parts.push(text);
      }
    }
  }
  return parts.join("\n").trim();
}

function extractFunctionCalls(
  output: ResponsesOutputItem[] | undefined
): ResponsesFunctionCall[] {
  if (!output?.length) return [];
  return output.filter(
    (item): item is ResponsesFunctionCall =>
      item.type === "function_call" &&
      typeof (item as ResponsesFunctionCall).call_id === "string" &&
      typeof (item as ResponsesFunctionCall).name === "string"
  );
}

async function createResponse(input: {
  input: ResponsesInputItem[];
  previousResponseId?: string;
}): Promise<{
  id: string;
  functionCalls: ResponsesFunctionCall[];
  text: string;
}> {
  const apiKey = getOpenAIApiKey();
  const model = getOpenAIChatModel();

  const payload: Record<string, unknown> = {
    model,
    input: input.input,
    tools: toResponsesTools(ASSISTENTE_TOOL_DEFINITIONS),
    tool_choice: "auto",
  };
  if (input.previousResponseId) {
    payload.previous_response_id = input.previousResponseId;
  }

  const res = await fetch(`${OPENAI_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await res.json().catch(() => null)) as ResponsesApiBody | null;

  if (!res.ok) {
    const msg = body?.error?.message || `OpenAI HTTP ${res.status}`;
    throw new Error(msg);
  }

  if (!body?.id) {
    throw new Error("OpenAI Responses retornou id vazio");
  }

  return {
    id: body.id,
    functionCalls: extractFunctionCalls(body.output),
    text: extractOutputText(body),
  };
}

function parseToolArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

export type AssistenteLoopResult = {
  content: string;
  toolTrace: AssistenteToolTraceItem[];
  model: string;
};

/**
 * Runs the OpenAI tool-calling loop until a final text answer (or max rounds).
 * `onTool` is called after each tool execution (for audit persistence).
 */
export async function runAssistenteToolLoop(input: {
  systemPrompt: string;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  pendingAnexo?: AssistentePendingAnexo | null;
  onTool?: (item: AssistenteToolTraceItem) => Promise<void>;
}): Promise<AssistenteLoopResult> {
  const model = getOpenAIChatModel();
  const toolTrace: AssistenteToolTraceItem[] = [];

  let previousResponseId: string | undefined;
  let nextInput: ResponsesInputItem[] = [
    { role: "system", content: input.systemPrompt },
    ...input.history.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user", content: input.userMessage },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await createResponse({
      input: nextInput,
      previousResponseId,
    });
    previousResponseId = response.id;

    const functionCalls = response.functionCalls;
    if (!functionCalls.length) {
      const content = response.text.trim();
      if (!content) {
        throw new Error("Assistente retornou resposta vazia");
      }
      return { content, toolTrace, model };
    }

    const toolOutputs: ResponsesInputItem[] = [];

    for (const call of functionCalls) {
      const name = call.name || "unknown";
      const args = parseToolArgs(call.arguments ?? "{}");
      const result: AssistenteToolResult = await executeAssistenteTool(
        name,
        args,
        { pendingAnexo: input.pendingAnexo }
      );
      const parsedArgs =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : { raw: args };
      const item: AssistenteToolTraceItem = {
        name,
        args: parsedArgs,
        result,
        confirmationId: result.confirmationId,
        confirmationStatus: result.requiresConfirmation ? "pending" : undefined,
      };
      toolTrace.push(item);
      // Audit reads immediately; write proposals wait until UI confirm.
      if (input.onTool && !result.requiresConfirmation) {
        await input.onTool(item);
      }

      // Tell the model confirmation is pending — do not claim the action ran.
      const toolPayload = result.requiresConfirmation
        ? {
            ok: true,
            requiresConfirmation: true,
            confirmationId: result.confirmationId,
            summary: result.summary,
            confirmationLabel: result.confirmationLabel,
            hint: "Ação NÃO executada. Peça ao usuário para confirmar o card na interface.",
          }
        : result;

      toolOutputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(toolPayload),
      });
    }

    nextInput = toolOutputs;
  }

  return {
    content:
      "Não consegui concluir com as ferramentas disponíveis. Reformule o pedido ou tente com mais detalhes (CPF/telefone).",
    toolTrace,
    model,
  };
}
