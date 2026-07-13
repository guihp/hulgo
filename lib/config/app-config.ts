import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type AppConfigKey =
  | "whatsapp_instancia"
  | "escritorio_nome"
  | "n8n_integracao_token";

const CONFIG_KEYS: AppConfigKey[] = [
  "whatsapp_instancia",
  "escritorio_nome",
  "n8n_integracao_token",
];

export type AppConfigMap = Record<AppConfigKey, string>;

const EMPTY_CONFIG: AppConfigMap = {
  whatsapp_instancia: "",
  escritorio_nome: "",
  n8n_integracao_token: "",
};

export async function getAppConfig(): Promise<AppConfigMap> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_config")
    .select("chave, valor")
    .in("chave", CONFIG_KEYS);

  if (error || !data?.length) {
    return {
      whatsapp_instancia: process.env.EVOGO_INSTANCE_NAME ?? "",
      escritorio_nome: "Boueres e Fonteles Advogados",
      n8n_integracao_token: "",
    };
  }

  const map = { ...EMPTY_CONFIG };
  for (const row of data) {
    if (row.chave in map) {
      map[row.chave as AppConfigKey] = row.valor ?? "";
    }
  }

  if (!map.whatsapp_instancia.trim()) {
    map.whatsapp_instancia = process.env.EVOGO_INSTANCE_NAME ?? "";
  }

  return map;
}

export async function getAppConfigValue(key: AppConfigKey): Promise<string> {
  const config = await getAppConfig();
  return config[key];
}

export async function getWhatsAppInstancia(contactNorm?: string): Promise<string> {
  if (contactNorm) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("mensagens")
      .select("instancia")
      .eq("contact_norm", contactNorm)
      .not("instancia", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const fromMessage = data?.instancia?.trim();
    if (fromMessage) return fromMessage;
  }

  const fromConfig = await getAppConfigValue("whatsapp_instancia");
  if (fromConfig.trim()) return fromConfig.trim();

  return process.env.EVOGO_INSTANCE_NAME?.trim() ?? "";
}

function getEnvIntegracaoToken(): string {
  return process.env.N8N_INTEGRACAO_TOKEN?.trim() ?? "";
}

export async function verifyIntegracaoToken(token: string | null): Promise<boolean> {
  if (!token?.trim()) return false;

  const service = createServiceClient();
  const { data } = await service
    .from("app_config")
    .select("valor")
    .eq("chave", "n8n_integracao_token")
    .maybeSingle();

  const expected = data?.valor?.trim() || getEnvIntegracaoToken();
  if (!expected) return false;

  return token.trim() === expected;
}

export async function getIntegracaoTokenForServer(): Promise<string> {
  const service = createServiceClient();
  const { data } = await service
    .from("app_config")
    .select("valor")
    .eq("chave", "n8n_integracao_token")
    .maybeSingle();

  return data?.valor?.trim() || getEnvIntegracaoToken();
}
