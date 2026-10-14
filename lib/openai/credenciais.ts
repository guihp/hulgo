import "server-only";

import { decifrar } from "@/lib/crypto/segredos";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Chave e modelos da OpenAI: o que foi salvo no painel (Configurações →
 * Inteligência artificial) vale primeiro; o que estiver vazio cai nas envs
 * do Coolify (OPENAI_API_KEY, OPENAI_MODEL, OPENAI_TRANSCRIBE_MODEL).
 */

export const MODELO_PADRAO = "gpt-5.6-luna";
export const MODELO_TRANSCRICAO_PADRAO = "whisper-1";

export type OpenAIConfig = {
  apiKey: string;
  origemChave: "painel" | "ambiente" | "nenhuma";
  modeloChat: string;
  modeloWhatsapp: string;
  modeloTranscricao: string;
  raciocinioWhatsapp: "low" | "medium" | "high";
};

const TTL_MS = 60_000;
let cache: { em: number; config: OpenAIConfig } | null = null;

export function invalidarCacheOpenAI() {
  cache = null;
}

async function carregar(): Promise<OpenAIConfig> {
  const envKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const envModelo = process.env.OPENAI_MODEL?.trim() || MODELO_PADRAO;
  const envTranscricao = process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || MODELO_TRANSCRICAO_PADRAO;
  const envRaciocinio = process.env.IA_WHATSAPP_REASONING?.trim();

  let row: {
    openai_key_cifrada: string | null;
    modelo_chat: string | null;
    modelo_whatsapp: string | null;
    modelo_transcricao: string | null;
    raciocinio_whatsapp: "low" | "medium" | "high" | null;
  } | null = null;
  try {
    const { data } = await createServiceClient()
      .from("app_ia_credenciais")
      .select("openai_key_cifrada, modelo_chat, modelo_whatsapp, modelo_transcricao, raciocinio_whatsapp")
      .eq("id", 1)
      .maybeSingle();
    row = data;
  } catch {
    // banco indisponível → só envs
  }

  let apiKey = envKey;
  let origemChave: OpenAIConfig["origemChave"] = envKey ? "ambiente" : "nenhuma";
  if (row?.openai_key_cifrada) {
    try {
      apiKey = decifrar(row.openai_key_cifrada);
      origemChave = "painel";
    } catch (e) {
      // APP_ENCRYPTION_KEY trocada/ausente: não derruba o atendimento se houver env.
      console.error("[openai] chave do painel não pôde ser lida:", e instanceof Error ? e.message : e);
    }
  }

  const modeloChat = row?.modelo_chat?.trim() || envModelo;
  return {
    apiKey,
    origemChave,
    modeloChat,
    modeloWhatsapp: row?.modelo_whatsapp?.trim() || modeloChat,
    modeloTranscricao: row?.modelo_transcricao?.trim() || envTranscricao,
    raciocinioWhatsapp:
      row?.raciocinio_whatsapp ??
      (envRaciocinio === "low" || envRaciocinio === "medium" || envRaciocinio === "high"
        ? envRaciocinio
        : "high"),
  };
}

export async function getOpenAIConfig(): Promise<OpenAIConfig> {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.config;
  const config = await carregar();
  cache = { em: Date.now(), config };
  return config;
}

export async function exigirChaveOpenAI(): Promise<string> {
  const { apiKey } = await getOpenAIConfig();
  if (!apiKey) {
    throw new Error(
      "Chave da OpenAI não configurada. Cadastre em Configurações → Inteligência artificial."
    );
  }
  return apiKey;
}
