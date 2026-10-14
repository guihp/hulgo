import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/types/database";

export type IaWhatsappConfig = Tables<"app_ia_whatsapp_config">;
export type IaModo = IaWhatsappConfig["modo"];

export const IA_MODOS: { value: IaModo; label: string; descricao: string }[] = [
  {
    value: "desligado",
    label: "Desligada",
    descricao: "Mensagens são salvas no painel, mas a IA não responde ninguém.",
  },
  {
    value: "teste",
    label: "Modo teste",
    descricao: "A IA responde só os números de teste. Os demais só ficam salvos.",
  },
  {
    value: "publico",
    label: "Liberada para o público",
    descricao: "A IA responde todos os clientes (exceto conversas pausadas).",
  },
];

/** Dígitos com DDI 55 e 9º dígito (mesma regra de normalize_phone_digits no banco). */
export function normalizarTelefone(raw: string | null | undefined): string {
  let d = String(raw ?? "")
    .split("@")[0]
    .replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length === 12 && d.startsWith("55") && "6789".includes(d[4])) {
    d = `${d.slice(0, 4)}9${d.slice(4)}`;
  }
  return d;
}

export async function getIaConfig(): Promise<IaWhatsappConfig> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("app_ia_whatsapp_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Config da IA do WhatsApp: ${error.message}`);
  if (!data) throw new Error("Config da IA do WhatsApp não encontrada (app_ia_whatsapp_config)");
  return data;
}

export function iaAtendeTelefone(config: IaWhatsappConfig, telefone: string): boolean {
  if (config.modo === "desligado") return false;
  if (config.modo === "publico") return true;
  const alvo = normalizarTelefone(telefone);
  return config.numeros_teste.some((n) => normalizarTelefone(n) === alvo);
}

export function ehNumeroDeTeste(config: IaWhatsappConfig, telefone: string): boolean {
  const alvo = normalizarTelefone(telefone);
  return config.numeros_teste.some((n) => normalizarTelefone(n) === alvo);
}

export function ehAdvogado(config: IaWhatsappConfig, telefone: string): boolean {
  const alvo = normalizarTelefone(telefone);
  return Boolean(alvo) && config.numeros_advogado.some((n) => normalizarTelefone(n) === alvo);
}

/** URL pública do painel (links nas mensagens ao advogado). */
export function urlPainel(): string {
  return (process.env.APP_URL?.trim() || "https://advocacia.iafeoficial.com").replace(/\/$/, "");
}
