import "server-only";

import { normalizarTelefone } from "@/lib/ia-whatsapp/config";
import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/types/database";

export type IaEstado = Tables<"app_ia_estado">;

export type MotivoPausa =
  | "advogado_celular"
  | "painel"
  | "aprovacao"
  | "aprovacao_recusada"
  | "manual";

export async function getIaEstado(telefone: string): Promise<IaEstado | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("app_ia_estado")
    .select("*")
    .eq("telefone", normalizarTelefone(telefone))
    .maybeSingle();
  return data ?? null;
}

export async function iaEstaPausada(telefone: string): Promise<boolean> {
  return Boolean((await getIaEstado(telefone))?.pausada);
}

export async function pausarIA(telefone: string, motivo: MotivoPausa): Promise<void> {
  const tel = normalizarTelefone(telefone);
  if (!tel) return;
  const supabase = createServiceClient();
  const agora = new Date().toISOString();
  const { error } = await supabase.from("app_ia_estado").upsert(
    {
      telefone: tel,
      pausada: true,
      pausada_em: agora,
      pausada_motivo: motivo,
      updated_at: agora,
    },
    { onConflict: "telefone" }
  );
  if (error) throw new Error(`Falha ao pausar a IA: ${error.message}`);
}

export async function despausarIA(telefone: string): Promise<void> {
  const tel = normalizarTelefone(telefone);
  if (!tel) return;
  const supabase = createServiceClient();
  const { error } = await supabase.from("app_ia_estado").upsert(
    {
      telefone: tel,
      pausada: false,
      pausada_em: null,
      pausada_motivo: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "telefone" }
  );
  if (error) throw new Error(`Falha ao liberar a IA: ${error.message}`);
}

/** /reset: a IA esquece a conversa até agora e volta a responder. */
export async function reiniciarMemoriaIA(telefone: string): Promise<void> {
  const tel = normalizarTelefone(telefone);
  const supabase = createServiceClient();
  const agora = new Date().toISOString();
  const { data: ultima } = await supabase
    .from("mensagens")
    .select("id")
    .eq("contact_norm", tel)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("app_ia_estado").upsert(
    {
      telefone: tel,
      pausada: false,
      pausada_em: null,
      pausada_motivo: null,
      memoria_desde: agora,
      ultima_mensagem_id: ultima?.id ?? null,
      updated_at: agora,
    },
    { onConflict: "telefone" }
  );
  if (error) throw new Error(`Falha ao reiniciar a memória: ${error.message}`);
  await supabase.from("app_ia_fila").delete().eq("telefone", tel);
}
