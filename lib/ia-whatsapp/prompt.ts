import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

export type PromptAgente = { texto: string; origem: string };

/** Persona publicada (ou rascunho, se pedido) em app_agente_config. */
export async function carregarPersona(usarRascunho: boolean): Promise<PromptAgente> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("app_agente_config")
    .select("persona, persona_rascunho, versao")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Prompt do agente: ${error.message}`);
  const rascunho = data?.persona_rascunho?.trim();
  if (usarRascunho && rascunho) return { texto: rascunho, origem: "rascunho" };
  const persona = data?.persona?.trim();
  if (!persona) throw new Error("Prompt do agente vazio — publique em Configurações → Agente");
  return { texto: persona, origem: `publicado v${data?.versao ?? 0}` };
}

/**
 * O prompt foi escrito para o n8n e ainda tem expressões `{{ ... }}`.
 * Troca as conhecidas pelos dados reais e remove o resto.
 */
export function substituirExpressoesN8n(
  texto: string,
  dados: { telefone: string; nome: string; urlsMidia: string[] }
): string {
  return texto.replace(/\{\{([\s\S]*?)\}\}/g, (_, expr: string) => {
    if (/conteudo_media|mídia|midia/i.test(expr)) return dados.urlsMidia.join(" ") || "";
    if (/pushName/i.test(expr)) return dados.nome;
    if (/telefone/i.test(expr)) return dados.telefone;
    return "";
  });
}

function agoraEmBrasilia(): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

export function montarSystemPrompt(
  persona: string,
  dados: { telefone: string; nome: string; urlsMidia: string[] }
): string {
  return [
    substituirExpressoesN8n(persona, dados),
    "",
    "# CONTEXTO DO SISTEMA (gerado automaticamente)",
    `Agora: ${agoraEmBrasilia()} (horário de Brasília).`,
    `Telefone do cliente: ${dados.telefone}. As ferramentas já usam este telefone.`,
    `Nome no WhatsApp: ${dados.nome || "não informado"}.`,
    "Mensagens seguidas do cliente chegam juntas, uma por linha.",
    "Arquivos do cliente aparecem com url_media — use exatamente essa URL em registrar_documento_cliente.",
    "Responda em texto de WhatsApp: *negrito* com um asterisco, sem títulos com #. Cada parágrafo vira uma mensagem separada; mantenha listas junto da frase que as introduz.",
  ].join("\n");
}
