import "server-only";

import { normalizarTelefone } from "@/lib/ia-whatsapp/config";
import { marcarAtendimento } from "@/lib/ia-whatsapp/etiquetas-atendimento";
import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/types/database";

export type IaEstado = Tables<"app_ia_estado">;

export type MotivoPausa =
  | "advogado_celular"
  | "painel"
  | "aprovacao"
  | "aprovacao_recusada"
  | "transferencia"
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
  await marcarAtendimento(tel, "humano");
}

/**
 * Devolve a conversa para a IA. Ela não responde o que já foi conversado:
 * espera a próxima mensagem do cliente, com toda a conversa (inclusive a da
 * equipe) na memória. A etiqueta "IA atendendo" entra quando ela responder.
 */
export async function despausarIA(telefone: string): Promise<void> {
  const tel = normalizarTelefone(telefone);
  if (!tel) return;
  const supabase = createServiceClient();
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
      ...(ultima ? { ultima_mensagem_id: ultima.id } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "telefone" }
  );
  if (error) throw new Error(`Falha ao liberar a IA: ${error.message}`);
  await marcarAtendimento(tel, null);
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

/**
 * /reset do número de teste: além de zerar a memória, desfaz o que o teste
 * deixou ligado ao número — o card volta a "Em atendimento" sem CPF/dados (o CPF
 * é o que liga processo e parceiro à conversa), processos soltam o card e o
 * telefone, e aprovações pendentes são encerradas. Só chame para número de teste.
 */
export async function resetarNumeroTeste(telefone: string): Promise<void> {
  const tel = normalizarTelefone(telefone);
  const supabase = createServiceClient();
  await reiniciarMemoriaIA(tel);

  const { data: casos } = await supabase.from("casos_novos").select("id").eq("telefone", tel);
  const casoIds = (casos ?? []).map((c) => c.id);
  if (casoIds.length) {
    await supabase.from("processos_clientes").update({ caso_id: null }).in("caso_id", casoIds);
    await supabase
      .from("casos_novos")
      .update({
        cpf: null,
        data_nascimento: null,
        beneficio_identificado: null,
        area: null,
        tipo_segurado: null,
        ja_negou_inss: null,
        motivo_negativa: null,
        ja_tem_processo: null,
        ja_recebe_beneficio: null,
        requisitos_preenchidos: null,
        requisitos_pendentes: null,
        documentos_recebidos: null,
        documentos_faltantes: null,
        pontos_analise_juridica: null,
        beneficios_alternativos: null,
        relatorio: null,
        consulta_tse: null,
        consulta_dap_caf: null,
        consulta_jf: null,
        status: "em_atendimento",
        mensagem_encaminhamento_enviada_em: null,
        updated_at: new Date().toISOString(),
      })
      .in("id", casoIds);
  }
  await supabase.from("processos_clientes").update({ telefone: null }).eq("telefone", tel);
  await supabase
    .from("aprovacoes_pendentes")
    .update({
      status: "recusado",
      motivo_recusa: "Encerrada pelo /reset do número de teste",
      decidido_em: new Date().toISOString(),
    })
    .eq("status", "pendente")
    .in("telefone_cliente", [tel, telefone]);
  await marcarAtendimento(tel, null);
}
