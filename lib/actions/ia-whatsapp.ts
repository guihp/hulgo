"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { getAppUser } from "@/lib/actions/auth";
import { getAgenteConfig, publicarAgenteConfig } from "@/lib/actions/configuracoes";
import { normalizarTelefone, type IaModo } from "@/lib/ia-whatsapp/config";
import { despausarIA, pausarIA, reiniciarMemoriaIA } from "@/lib/ia-whatsapp/estado";
import { processarFilaIA } from "@/lib/ia-whatsapp/processar";
import { createServiceClient } from "@/lib/supabase/service";

async function exigirAdvogado() {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (user.papel !== "advogado") throw new Error("Apenas advogados podem alterar a IA do WhatsApp");
  return user;
}

function listaTelefones(valores: string[]): string[] {
  const unicos = new Set<string>();
  for (const v of valores) {
    const t = normalizarTelefone(v);
    if (t.length >= 12) unicos.add(t);
  }
  return [...unicos];
}

export async function salvarConfigIA(input: {
  modo: IaModo;
  numerosTeste: string[];
  usarRascunhoNoTeste: boolean;
  debounceSegundos: number;
  grupoAdvogado: string;
  numerosAdvogado: string[];
}) {
  const user = await exigirAdvogado();
  if (!["desligado", "teste", "publico"].includes(input.modo)) throw new Error("Modo inválido");
  const debounce = Math.round(input.debounceSegundos);
  if (!(debounce >= 3 && debounce <= 120)) throw new Error("Espera deve ficar entre 3 e 120 segundos");

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("app_ia_whatsapp_config")
    .update({
      modo: input.modo,
      numeros_teste: listaTelefones(input.numerosTeste),
      usar_rascunho_no_teste: input.usarRascunhoNoTeste,
      debounce_segundos: debounce,
      grupo_advogado: input.grupoAdvogado.trim() || null,
      numeros_advogado: listaTelefones(input.numerosAdvogado),
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", 1);
  if (error) throw new Error(error.message);

  await supabase.from("app_log_eventos").insert({
    usuario_id: user.id,
    entidade: "app_ia_whatsapp_config",
    entidade_id: 1,
    acao: "salvar",
    payload: { modo: input.modo },
  });
  revalidatePath("/ia-whatsapp");
  return { success: true as const };
}

export async function alterarPausaIA(telefone: string, pausar: boolean) {
  await exigirAdvogado();
  if (pausar) await pausarIA(telefone, "manual");
  else await despausarIA(telefone);
  revalidatePath("/ia-whatsapp");
  return { success: true as const };
}

export async function reiniciarMemoriaIAAction(telefone: string) {
  await exigirAdvogado();
  await reiniciarMemoriaIA(telefone);
  revalidatePath("/ia-whatsapp");
  return { success: true as const };
}

export async function processarFilaIAAgora() {
  await exigirAdvogado();
  const r = await processarFilaIA();
  revalidatePath("/ia-whatsapp");
  return r;
}

export async function gerarNovoTokenWebhook() {
  await exigirAdvogado();
  const supabase = createServiceClient();
  const token = randomBytes(24).toString("hex");
  const { error } = await supabase
    .from("app_ia_whatsapp_config")
    .update({ webhook_token: token, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  revalidatePath("/ia-whatsapp");
  return { token };
}

/** Publica para todos os clientes a versão das instruções que está em teste (rascunho). */
export async function publicarVersaoEmTeste() {
  await exigirAdvogado();
  const config = await getAgenteConfig();
  if (!config) throw new Error("As instruções da IA ainda não foram configuradas.");
  if (config.persona.trim() === config.persona_publicada.trim()) {
    throw new Error("Não há alteração em teste para publicar.");
  }
  const publicado = await publicarAgenteConfig({
    persona: config.persona,
    mensagem_abertura: config.mensagem_abertura || config.mensagem_abertura_publicada,
  });
  revalidatePath("/ia-whatsapp");
  return { versao: publicado.versao };
}
