"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { AprovacaoStatus, CasoStatus, Json } from "@/types/database";
import { normalizeCpf } from "@/lib/utils/cpf";
import { brazilianDateToIso } from "@/lib/utils/dates";
import { normalizePhoneBrStorage } from "@/lib/utils/phone";
import {
  isValidNumeroProcesso,
  normalizeNumeroProcesso,
} from "@/lib/utils/processo";

async function logEvent(
  entidade: string,
  entidadeId: number,
  acao: string,
  payload?: Json
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await supabase.from("app_log_eventos").insert({
    usuario_id: user?.id ?? null,
    entidade,
    entidade_id: entidadeId,
    acao,
    payload: payload ?? null,
  });
}

export async function updateCasoStatus(id: number, status: CasoStatus) {
  return updateCasoStatusCliente([id], status);
}

/**
 * Move todas as linhas do cliente de uma vez (o n8n pode ter criado mais de
 * um caso para o mesmo telefone). Ao entrar em "Aguardando aprovação", cria a
 * pendência em aprovacoes_pendentes se ainda não houver uma pendente.
 */
export async function updateCasoStatusCliente(ids: number[], status: CasoStatus) {
  if (!ids.length) throw new Error("Nenhum caso para mover");

  const supabase = await createClient();
  const { error } = await supabase
    .from("casos_novos")
    .update({ status })
    .in("id", ids);

  if (error) throw new Error(error.message);

  let aprovacaoCriada = false;
  if (status === "aguardando_aprovacao") {
    aprovacaoCriada = await criarPendenciaSeFaltar(ids[0]);
  }

  revalidatePath("/kanban");
  revalidatePath("/aprovacoes");
  revalidatePath("/clientes");
  revalidatePath("/");
  return { success: true, aprovacaoCriada };
}

/** Garante pendência em aprovacoes_pendentes para o cliente do caso. */
async function criarPendenciaSeFaltar(casoId: number): Promise<boolean> {
  const supabase = await createClient();
  const { data: caso } = await supabase
    .from("casos_novos")
    .select("nome, cpf, telefone, beneficio_identificado, relatorio")
    .eq("id", casoId)
    .single();

  const telefone = caso?.telefone?.replace(/\D/g, "") ?? "";
  // telefone_cliente é NOT NULL — sem telefone não há como criar a pendência
  if (!caso || !telefone) return false;

  const cpf = caso.cpf ? normalizeCpf(caso.cpf) : null;
  let query = supabase
    .from("aprovacoes_pendentes")
    .select("id")
    .eq("status", "pendente")
    .limit(1);
  query = cpf
    ? query.or(`telefone_cliente.eq.${telefone},cpf.eq.${cpf}`)
    : query.eq("telefone_cliente", telefone);
  const { data: pendentes } = await query;
  if (pendentes?.length) return false;

  const resumo =
    caso.relatorio?.trim() ||
    `Caso em triagem movido para aprovação pelo painel.` +
      (caso.beneficio_identificado
        ? ` Benefício identificado: ${caso.beneficio_identificado}.`
        : "");

  const { error } = await supabase.from("aprovacoes_pendentes").insert({
    telefone_cliente: telefone,
    nome_cliente: caso.nome,
    cpf,
    resumo,
    status: "pendente",
    enviado_whatsapp: false,
  });
  if (error) throw new Error(`Caso movido, mas falhou ao criar a pendência: ${error.message}`);

  await logEvent("casos_novos", casoId, "pendencia_criada_painel", {
    telefone_cliente: telefone,
  });
  return true;
}

export async function updateCasoFields(
  id: number,
  fields: {
    nome?: string | null;
    cpf?: string | null;
    data_nascimento?: string | null;
    telefone?: string | null;
    beneficio_identificado?: string | null;
    area?: string | null;
    tipo_segurado?: string | null;
    ja_negou_inss?: boolean | null;
    motivo_negativa?: string | null;
    ja_tem_processo?: boolean | null;
    ja_recebe_beneficio?: string | null;
    requisitos_preenchidos?: string | null;
    requisitos_pendentes?: string | null;
    pontos_analise_juridica?: string | null;
    beneficios_alternativos?: string | null;
    consulta_tse?: string;
    consulta_dap_caf?: string;
    consulta_jf?: string;
    documentos_recebidos?: string;
    documentos_faltantes?: string;
  }
) {
  const supabase = await createClient();
  const { error } = await supabase.from("casos_novos").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/kanban/${id}`);
  return { success: true };
}

export async function addNotaCaso(casoId: number, conteudo: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado");

  const { error } = await supabase.from("app_notas_caso").insert({
    caso_id: casoId,
    autor_id: user.id,
    conteudo,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/kanban/${casoId}`);
  return { success: true };
}

export async function marcarProcessoCriado(
  casoId: number,
  numeroProcesso: string
) {
  if (!isValidNumeroProcesso(numeroProcesso)) {
    throw new Error("Número de processo CNJ inválido");
  }

  const supabase = await createClient();
  const { data: caso, error: casoError } = await supabase
    .from("casos_novos")
    .select("*")
    .eq("id", casoId)
    .single();

  if (casoError || !caso) throw new Error("Caso não encontrado");
  if (!caso.nome || !caso.cpf) {
    throw new Error("Caso sem nome ou CPF para criar processo");
  }

  const { error: processoError } = await supabase
    .from("processos_clientes")
    .insert({
      nome: caso.nome,
      cpf: normalizeCpf(caso.cpf),
      data_nascimento: caso.data_nascimento,
      telefone: caso.telefone,
      numero_processo: normalizeNumeroProcesso(numeroProcesso),
      area: caso.area,
      descricao_caso: caso.beneficio_identificado,
      ativo: true,
    });

  if (processoError) throw new Error(processoError.message);

  const { error: updateError } = await supabase
    .from("casos_novos")
    .update({ status: "processo_finalizado" })
    .eq("id", casoId);

  if (updateError) throw new Error(updateError.message);

  await logEvent("casos_novos", casoId, "processo_criado", {
    numero_processo: numeroProcesso,
  });

  revalidatePath("/kanban");
  revalidatePath(`/kanban/${casoId}`);
  revalidatePath("/clientes");
  revalidatePath("/");
  return { success: true };
}

async function callN8nWebhook(
  idAprovacao: number,
  acao: string,
  textoManual?: string
) {
  const webhookUrl = process.env.N8N_WEBHOOK_APROVACAO;
  if (!webhookUrl) return { ok: false, error: "Webhook não configurado" };

  const payload = {
    id_aprovacao: idAprovacao,
    acao,
    ...(textoManual ? { texto_manual: textoManual } : {}),
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return { ok: true };
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return { ok: false, error: "Falha após 3 tentativas" };
}

export async function atualizarAprovacao(
  id: number,
  status: AprovacaoStatus,
  textoManual?: string
) {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("app_usuarios")
    .select("papel")
    .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "")
    .single();

  if (profile?.papel !== "advogado") {
    throw new Error("Apenas advogados podem aprovar pendências");
  }

  const { error } = await supabase
    .from("aprovacoes_pendentes")
    .update({ status })
    .eq("id", id);

  if (error) throw new Error(error.message);

  const acaoMap: Record<AprovacaoStatus, string> = {
    aprovado: "aprovar",
    recusado: "recusar",
    respondido_manual: "responder",
    pendente: "pendente",
  };

  const webhook = await callN8nWebhook(id, acaoMap[status], textoManual);

  await logEvent("aprovacoes_pendentes", id, "aprovacao", {
    status,
    webhook_ok: webhook.ok,
    ...(webhook.error ? { webhook_error: webhook.error } : {}),
  });

  revalidatePath("/aprovacoes");
  revalidatePath("/");
  return { success: true, webhook };
}

export async function reenviarWebhookAprovacao(id: number, status: AprovacaoStatus, textoManual?: string) {
  const webhook = await callN8nWebhook(
    id,
    status === "aprovado" ? "aprovar" : status === "recusado" ? "recusar" : "responder",
    textoManual
  );
  await logEvent("aprovacoes_pendentes", id, "webhook_retry", {
    webhook_ok: webhook.ok,
    ...(webhook.error ? { webhook_error: webhook.error } : {}),
  });
  return webhook;
}

export async function upsertProcesso(
  data: {
    id?: number;
    nome: string;
    cpf: string;
    data_nascimento?: string | null;
    telefone?: string | null;
    numero_processo: string;
    tribunal?: string | null;
    area?: string | null;
    descricao_caso?: string | null;
    ativo?: boolean;
  }
) {
  const supabase = await createClient();
  const dataNascimento =
    data.data_nascimento && data.data_nascimento.includes("/")
      ? brazilianDateToIso(data.data_nascimento) ?? data.data_nascimento
      : data.data_nascimento;

  const payload = {
    ...data,
    cpf: normalizeCpf(data.cpf),
    numero_processo: normalizeNumeroProcesso(data.numero_processo),
    telefone: data.telefone ? normalizePhoneBrStorage(data.telefone) : data.telefone,
    data_nascimento: dataNascimento,
  };

  if (data.id) {
    const { error } = await supabase
      .from("processos_clientes")
      .update(payload)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
  } else {
    if (!isValidNumeroProcesso(payload.numero_processo)) {
      throw new Error("Número de processo CNJ inválido");
    }
    const { error } = await supabase.from("processos_clientes").insert(payload);
    if (error) throw new Error(error.message);

    // Cliente ganhou processo — move o caso dele no Kanban para finalizado
    const telefone = payload.telefone?.replace(/\D/g, "") ?? "";
    let casosQuery = supabase
      .from("casos_novos")
      .update({ status: "processo_finalizado" })
      .neq("status", "processo_finalizado");
    casosQuery = telefone
      ? casosQuery.or(`cpf.eq.${payload.cpf},telefone.eq.${telefone}`)
      : casosQuery.eq("cpf", payload.cpf);
    await casosQuery;
    revalidatePath("/kanban");
  }

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${payload.cpf}`);
  return { success: true };
}

export async function deleteProcesso(id: number) {
  const supabase = await createClient();
  const { error } = await supabase.from("processos_clientes").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/clientes");
  return { success: true };
}
