"use server";

import { getAppUser } from "@/lib/actions/auth";
import { cifrar, criptografiaConfigurada } from "@/lib/crypto/segredos";
import {
  getOpenAIConfig,
  invalidarCacheOpenAI,
  MODELO_PADRAO,
  MODELO_TRANSCRICAO_PADRAO,
} from "@/lib/openai/credenciais";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Configurações → Inteligência artificial.
 * Regra de segurança: a chave NUNCA volta para o navegador — só os 4 últimos caracteres.
 */

type Raciocinio = "low" | "medium" | "high";

export type IaConfigResumo = {
  chave: { origem: "painel" | "ambiente" | "nenhuma"; final: string | null };
  criptografiaOk: boolean;
  salvos: {
    modeloChat: string | null;
    modeloWhatsapp: string | null;
    modeloTranscricao: string | null;
    raciocinioWhatsapp: Raciocinio | null;
  };
  efetivos: {
    modeloChat: string;
    modeloWhatsapp: string;
    modeloTranscricao: string;
    raciocinioWhatsapp: Raciocinio;
  };
  padroes: { modeloChat: string; modeloTranscricao: string };
  atualizadoEm: string | null;
};

async function exigirAdvogado() {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (user.papel !== "advogado") throw new Error("Apenas advogados podem alterar a configuração da IA");
  return user;
}

async function registrar(usuarioId: string, acao: string, payload: Record<string, string | null>) {
  await createServiceClient().from("app_log_eventos").insert({
    usuario_id: usuarioId,
    entidade: "app_ia_credenciais",
    entidade_id: 1,
    acao,
    payload,
  });
}

function final4(chave: string): string {
  return chave.slice(-4);
}

/** Lista os modelos da conta. Erros da OpenAI viram mensagens sem dados da chave. */
async function modelosDaConta(apiKey: string): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
  } catch {
    throw new Error("Não foi possível falar com a OpenAI agora. Tente de novo em instantes.");
  }
  if (res.status === 401) throw new Error("A OpenAI recusou esta chave (inválida ou revogada).");
  if (res.status === 403) throw new Error("Esta chave não tem permissão para listar modelos.");
  if (res.status === 429) throw new Error("A OpenAI limitou as consultas. Tente de novo em 1 minuto.");
  if (!res.ok) throw new Error(`A OpenAI respondeu com erro ${res.status}.`);
  const body = (await res.json().catch(() => null)) as { data?: { id?: string }[] } | null;
  return (body?.data ?? []).map((m) => m.id ?? "").filter(Boolean);
}

const NAO_CHAT = /(embedding|tts|whisper|transcribe|dall-e|image|audio|realtime|moderation|search|davinci|babbage|computer-use|codex)/i;

function separarModelos(ids: string[]) {
  const chat = ids
    .filter((id) => /^(gpt-|o\d|chatgpt-)/i.test(id) && !NAO_CHAT.test(id))
    // gpt-* primeiro, versões mais novas no topo
    .sort((a, b) => Number(!/^gpt-/i.test(a)) - Number(!/^gpt-/i.test(b)) || b.localeCompare(a));
  const transcricao = ids.filter((id) => /whisper|transcribe/i.test(id)).sort();
  return { chat, transcricao };
}

export async function obterConfigIA(): Promise<IaConfigResumo> {
  await exigirAdvogado();
  const { data } = await createServiceClient()
    .from("app_ia_credenciais")
    .select("openai_key_final, openai_key_cifrada, modelo_chat, modelo_whatsapp, modelo_transcricao, raciocinio_whatsapp, updated_at")
    .eq("id", 1)
    .maybeSingle();
  const efetivo = await getOpenAIConfig();
  const envKey = process.env.OPENAI_API_KEY?.trim() ?? "";

  return {
    chave: {
      origem: efetivo.origemChave,
      final:
        efetivo.origemChave === "painel"
          ? data?.openai_key_final ?? null
          : efetivo.origemChave === "ambiente"
            ? final4(envKey)
            : null,
    },
    criptografiaOk: criptografiaConfigurada(),
    salvos: {
      modeloChat: data?.modelo_chat ?? null,
      modeloWhatsapp: data?.modelo_whatsapp ?? null,
      modeloTranscricao: data?.modelo_transcricao ?? null,
      raciocinioWhatsapp: data?.raciocinio_whatsapp ?? null,
    },
    efetivos: {
      modeloChat: efetivo.modeloChat,
      modeloWhatsapp: efetivo.modeloWhatsapp,
      modeloTranscricao: efetivo.modeloTranscricao,
      raciocinioWhatsapp: efetivo.raciocinioWhatsapp,
    },
    padroes: {
      modeloChat: process.env.OPENAI_MODEL?.trim() || MODELO_PADRAO,
      modeloTranscricao: process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || MODELO_TRANSCRICAO_PADRAO,
    },
    atualizadoEm: data?.updated_at ?? null,
  };
}

/** Testa a chave na OpenAI; só grava (cifrada) se ela funcionar. */
export async function salvarChaveOpenAI(chave: string): Promise<{ final: string }> {
  const user = await exigirAdvogado();
  const limpa = chave.trim();
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(limpa)) {
    throw new Error("Isso não parece uma chave da OpenAI (começa com sk-).");
  }
  if (!criptografiaConfigurada()) {
    throw new Error(
      "O servidor ainda não tem a APP_ENCRYPTION_KEY. Peça ao responsável técnico para configurá-la no Coolify antes de salvar a chave."
    );
  }

  await modelosDaConta(limpa);

  const { error } = await createServiceClient()
    .from("app_ia_credenciais")
    .update({
      openai_key_cifrada: cifrar(limpa),
      openai_key_final: final4(limpa),
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", 1);
  if (error) throw new Error("Não foi possível salvar a chave.");

  invalidarCacheOpenAI();
  await registrar(user.id, "chave_openai_salva", { final: final4(limpa) });
  return { final: final4(limpa) };
}

/** Apaga a chave do painel (volta a valer a do Coolify, se houver). */
export async function removerChaveOpenAI(): Promise<void> {
  const user = await exigirAdvogado();
  const { error } = await createServiceClient()
    .from("app_ia_credenciais")
    .update({
      openai_key_cifrada: null,
      openai_key_final: null,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", 1);
  if (error) throw new Error("Não foi possível remover a chave.");
  invalidarCacheOpenAI();
  await registrar(user.id, "chave_openai_removida", {});
}

/** Modelos que a chave atual pode usar. */
export async function listarModelosOpenAI(): Promise<{ chat: string[]; transcricao: string[] }> {
  await exigirAdvogado();
  const { apiKey } = await getOpenAIConfig();
  if (!apiKey) throw new Error("Cadastre a chave da OpenAI primeiro.");
  return separarModelos(await modelosDaConta(apiKey));
}

/** null = usar o padrão. Cada modelo escolhido precisa existir na conta. */
export async function salvarModelosIA(input: {
  modeloChat: string | null;
  modeloWhatsapp: string | null;
  modeloTranscricao: string | null;
  raciocinioWhatsapp: Raciocinio | null;
}): Promise<void> {
  const user = await exigirAdvogado();
  const { apiKey } = await getOpenAIConfig();
  if (!apiKey) throw new Error("Cadastre a chave da OpenAI primeiro.");

  const disponiveis = new Set(await modelosDaConta(apiKey));
  for (const [rotulo, valor] of [
    ["assistente", input.modeloChat],
    ["WhatsApp", input.modeloWhatsapp],
    ["transcrição", input.modeloTranscricao],
  ] as const) {
    if (valor && !disponiveis.has(valor)) {
      throw new Error(`O modelo "${valor}" (${rotulo}) não está disponível nesta conta da OpenAI.`);
    }
  }
  if (input.raciocinioWhatsapp && !["low", "medium", "high"].includes(input.raciocinioWhatsapp)) {
    throw new Error("Nível de raciocínio inválido");
  }

  const { error } = await createServiceClient()
    .from("app_ia_credenciais")
    .update({
      modelo_chat: input.modeloChat,
      modelo_whatsapp: input.modeloWhatsapp,
      modelo_transcricao: input.modeloTranscricao,
      raciocinio_whatsapp: input.raciocinioWhatsapp,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", 1);
  if (error) throw new Error("Não foi possível salvar os modelos.");

  invalidarCacheOpenAI();
  await registrar(user.id, "modelos_ia_salvos", {
    modelo_chat: input.modeloChat,
    modelo_whatsapp: input.modeloWhatsapp,
    modelo_transcricao: input.modeloTranscricao,
    raciocinio_whatsapp: input.raciocinioWhatsapp,
  });
}
