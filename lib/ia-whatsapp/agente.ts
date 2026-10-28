import "server-only";

import {
  executarFerramenta,
  FERRAMENTAS,
  type ContextoFerramenta,
} from "@/lib/ia-whatsapp/ferramentas";
import {
  concluirEventoFerramenta,
  iniciarEventoFerramenta,
} from "@/lib/ia-whatsapp/eventos-ferramenta";
import { exigirChaveOpenAI, getOpenAIConfig } from "@/lib/openai/credenciais";

const OPENAI_BASE = "https://api.openai.com/v1";
const MAX_RODADAS = 10;

type Entrada =
  | { role: "system" | "user" | "assistant"; content: string }
  | { type: "function_call_output"; call_id: string; output: string };

type ChamadaFuncao = { type: "function_call"; call_id: string; name: string; arguments: string };

type RespostaApi = {
  id?: string;
  error?: { message?: string };
  output?: Array<{ type: string; [k: string]: unknown }>;
  output_text?: string;
};

export type ChamadaRegistrada = {
  nome: string;
  argumentos: Record<string, unknown>;
  resultado: unknown;
  erro?: string;
};

function textoDaResposta(body: RespostaApi): string {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text.trim();
  const partes: string[] = [];
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    const content = item.content;
    if (typeof content === "string") partes.push(content);
    else if (Array.isArray(content)) {
      for (const c of content) {
        if (typeof c === "string") partes.push(c);
        else if (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string") {
          partes.push((c as { text: string }).text);
        }
      }
    }
  }
  return partes.join("\n").trim();
}

async function chamarModelo(input: Entrada[], anterior?: string): Promise<RespostaApi & { id: string }> {
  const config = await getOpenAIConfig();
  const apiKey = await exigirChaveOpenAI();
  const payload: Record<string, unknown> = {
    model: config.modeloWhatsapp,
    input,
    tools: FERRAMENTAS,
    tool_choice: "auto",
    reasoning: { effort: config.raciocinioWhatsapp },
  };
  if (anterior) payload.previous_response_id = anterior;

  let ultimoErro = "";
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const res = await fetch(`${OPENAI_BASE}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => null)) as RespostaApi | null;
    if (res.ok && body?.id) return body as RespostaApi & { id: string };
    ultimoErro = body?.error?.message || `OpenAI HTTP ${res.status}`;
    // 429/5xx: tenta de novo; erro de requisição (400) não adianta repetir.
    if (res.status < 500 && res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 2000 * (tentativa + 1)));
  }
  throw new Error(ultimoErro);
}

/** Roda o agente com ferramentas até a resposta final em texto. */
export async function rodarAgente(input: {
  systemPrompt: string;
  historico: { role: "user" | "assistant"; content: string }[];
  mensagemAtual: string;
  contexto: ContextoFerramenta;
}): Promise<{ resposta: string; chamadas: ChamadaRegistrada[]; modelo: string }> {
  const chamadas: ChamadaRegistrada[] = [];
  let anterior: string | undefined;
  let proxima: Entrada[] = [
    { role: "system", content: input.systemPrompt },
    ...input.historico,
    { role: "user", content: input.mensagemAtual },
  ];

  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const body = await chamarModelo(proxima, anterior);
    anterior = body.id;

    const funcoes = (body.output ?? []).filter(
      (o): o is ChamadaFuncao => o.type === "function_call" && typeof o.call_id === "string"
    );
    if (!funcoes.length) {
      return { resposta: textoDaResposta(body), chamadas, modelo: (await getOpenAIConfig()).modeloWhatsapp };
    }

    const saidas: Entrada[] = [];
    for (const f of funcoes) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(f.arguments || "{}");
      } catch {
        // argumentos inválidos → objeto vazio
      }
      let resultado: unknown;
      let erro: string | undefined;
      const evento = await iniciarEventoFerramenta(input.contexto.telefone, f.name);
      try {
        resultado = await executarFerramenta(f.name, args, input.contexto);
      } catch (e) {
        erro = e instanceof Error ? e.message : "erro na ferramenta";
        resultado = { ok: false, erro };
      }
      await concluirEventoFerramenta(evento, resultado, erro);
      chamadas.push({ nome: f.name, argumentos: args, resultado, ...(erro ? { erro } : {}) });
      saidas.push({ type: "function_call_output", call_id: f.call_id, output: JSON.stringify(resultado) });
    }
    proxima = saidas;
  }

  throw new Error(`Agente não concluiu em ${MAX_RODADAS} rodadas de ferramentas`);
}
