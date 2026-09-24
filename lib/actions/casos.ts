"use server";

import { getAppUser } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { AprovacaoStatus, CasoStatus, Json } from "@/types/database";
import { enviarEncaminhamentoAnaliseSePendente } from "@/lib/casos/encaminhamento-analise";
import { isValidCpf, normalizeCpf } from "@/lib/utils/cpf";
import { brazilianDateToIso } from "@/lib/utils/dates";
import { fichaPessoaHref } from "@/lib/utils/ficha";
import {
  normalizePhoneBrStorage,
  phoneToContactNorm,
} from "@/lib/utils/phone";
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

export async function updateCasoStatus(id: number, status: string) {
  return updateCasoStatusCliente([id], status);
}

/**
 * Move todas as linhas do cliente de uma vez (o n8n pode ter criado mais de
 * um caso para o mesmo telefone). Ao entrar em "Aguardando aprovação", cria a
 * pendência em aprovacoes_pendentes se ainda não houver uma pendente.
 * `status` = chave de coluna (sistema ou personalizada em app_kanban_colunas).
 */
export async function updateCasoStatusCliente(ids: number[], status: string) {
  if (!ids.length) throw new Error("Nenhum caso para mover");
  const statusKey = status.trim();
  if (!statusKey) throw new Error("Status inválido");

  const supabase = await createClient();

  const { data: col } = await supabase
    .from("app_kanban_colunas")
    .select("chave")
    .eq("chave", statusKey)
    .eq("ativo", true)
    .maybeSingle();

  // Fallback: colunas de sistema conhecidas se a tabela ainda não existir
  const SYSTEM_KEYS = new Set([
    "em_atendimento",
    "consultar_processo",
    "abertura_processo",
    "aguardando_analise",
    "aguardando_aprovacao",
    "atendimento_humano",
    "processo_finalizado",
  ]);
  const systemOk = SYSTEM_KEYS.has(statusKey);

  if (!col && !systemOk) {
    throw new Error(`Coluna inválida ou inativa: ${statusKey}`);
  }

  const { error } = await supabase
    .from("casos_novos")
    .update({ status: statusKey })
    .in("id", ids);

  if (error) throw new Error(error.message);

  let aprovacaoCriada = false;
  if (statusKey === "aguardando_aprovacao") {
    aprovacaoCriada = await criarPendenciaSeFaltar(ids[0]);
  }

  let encaminhamento: { enviada: boolean; warning?: string } | undefined;
  if (statusKey === "aguardando_analise") {
    encaminhamento = await enviarEncaminhamentoAnaliseSePendente(ids);
  }

  revalidatePath("/kanban");
  revalidatePath("/aprovacoes");
  revalidatePath("/clientes");
  revalidatePath("/");
  return { success: true, aprovacaoCriada, encaminhamento };
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
  revalidatePath("/kanban");
  revalidatePath("/clientes");
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
      beneficio_identificado: caso.beneficio_identificado,
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
    beneficio_identificado?: string | null;
    descricao_caso?: string | null;
    parceiro_id?: string | null;
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
    beneficio_identificado: data.beneficio_identificado?.trim() || null,
    parceiro_id: data.parceiro_id || null,
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

  // Espelha benefício no caso vinculado (mesmo CPF/telefone) para a lista /clientes
  if (payload.beneficio_identificado) {
    const telefone = payload.telefone?.replace(/\D/g, "") ?? "";
    let syncQuery = supabase
      .from("casos_novos")
      .update({ beneficio_identificado: payload.beneficio_identificado });
    syncQuery = telefone
      ? syncQuery.or(`cpf.eq.${payload.cpf},telefone.eq.${telefone}`)
      : syncQuery.eq("cpf", payload.cpf);
    await syncQuery;
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

export type CriarClienteCasoInput = {
  nome: string;
  /** WhatsApp / celular — normalizado com DDI 55 (mesmo padrão de storage). */
  telefone: string;
  cpf?: string | null;
  /** Benefício / tipo de demanda (ex.: aposentadoria rural, BPC). */
  beneficio_identificado?: string | null;
  tipo_segurado?: string | null;
  area?: string | null;
  /** Default: em_atendimento (igual criação via atualizar_dados_caso). */
  status?: CasoStatus;
};

export type CriarClienteCasoResult = {
  success: true;
  casoId: number;
  created: boolean;
  href: string;
  nome: string;
  telefone: string;
  cpf: string | null;
  status: string;
  beneficio_identificado: string | null;
};

function telefoneLookupVariants(telefone: string): string[] {
  const stored = normalizePhoneBrStorage(telefone);
  const contact = phoneToContactNorm(telefone);
  const variants = new Set<string>();
  for (const v of [stored, contact, telefone.replace(/\D/g, "")]) {
    if (!v) continue;
    variants.add(v);
    if (v.startsWith("55") && v.length > 11) variants.add(v.slice(2));
    else if (v.length === 10 || v.length === 11) variants.add(`55${v}`);
  }
  return [...variants];
}

/**
 * Cria (ou reusa) cliente/pessoa no fluxo de triagem (`casos_novos`).
 * Alinhado a `atualizar_dados_caso` / n8n: telefone normalizado, CPF só dígitos,
 * status inicial `em_atendimento`. Se já existir caso pelo CPF (ou telefone),
 * completa campos vazios e devolve o existente + deep-link da ficha.
 */
export async function criarClienteCaso(
  input: CriarClienteCasoInput
): Promise<CriarClienteCasoResult> {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const nome = input.nome?.trim() ?? "";
  if (!nome) throw new Error("Nome é obrigatório");

  const telefoneRaw = input.telefone?.trim() ?? "";
  if (!telefoneRaw) throw new Error("Telefone é obrigatório");

  const telefone = normalizePhoneBrStorage(telefoneRaw);
  if (phoneToContactNorm(telefone).length < 10) {
    throw new Error("Telefone inválido");
  }

  const cpfRaw = input.cpf?.trim() ? normalizeCpf(input.cpf) : "";
  if (cpfRaw) {
    if (cpfRaw.length !== 11 || !isValidCpf(cpfRaw)) {
      throw new Error("CPF inválido");
    }
  }

  const beneficio =
    input.beneficio_identificado?.trim() || null;
  const tipoSegurado = input.tipo_segurado?.trim() || null;
  const area = input.area?.trim() || null;
  const status: CasoStatus = input.status ?? "em_atendimento";

  const supabase = await createClient();
  const casoSelect =
    "id, nome, cpf, telefone, status, beneficio_identificado, tipo_segurado, area";

  type CasoRow = {
    id: number;
    nome: string | null;
    cpf: string | null;
    telefone: string | null;
    status: string | null;
    beneficio_identificado: string | null;
    tipo_segurado: string | null;
    area: string | null;
  };

  let existing: CasoRow | null = null;

  if (cpfRaw) {
    const { data } = await supabase
      .from("casos_novos")
      .select(casoSelect)
      .eq("cpf", cpfRaw)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    existing = data;
  }

  if (!existing) {
    const variants = telefoneLookupVariants(telefone);
    const { data: byPhone } = await supabase
      .from("casos_novos")
      .select(casoSelect)
      .in("telefone", variants)
      .order("created_at", { ascending: false })
      .limit(5);
    const rows = byPhone ?? [];
    const target = phoneToContactNorm(telefone);
    existing =
      rows.find((r) => phoneToContactNorm(r.telefone) === target) ??
      rows[0] ??
      null;
  }

  const hrefFor = (cpf: string | null, phone: string) =>
    fichaPessoaHref({
      cpf,
      contactNorm: phoneToContactNorm(phone),
    });

  if (existing) {
    const patch: {
      nome?: string;
      cpf?: string;
      telefone?: string;
      beneficio_identificado?: string;
      tipo_segurado?: string;
      area?: string;
    } = {};
    if (!existing.nome && nome) patch.nome = nome;
    if (!existing.cpf && cpfRaw) patch.cpf = cpfRaw;
    if (!existing.telefone && telefone) patch.telefone = telefone;
    if (!existing.beneficio_identificado && beneficio) {
      patch.beneficio_identificado = beneficio;
    }
    if (!existing.tipo_segurado && tipoSegurado) {
      patch.tipo_segurado = tipoSegurado;
    }
    if (!existing.area && area) patch.area = area;

    if (Object.keys(patch).length) {
      const { error } = await supabase
        .from("casos_novos")
        .update(patch)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    }

    const cpfOut = (existing.cpf ? normalizeCpf(existing.cpf) : null) || cpfRaw || null;
    const telOut = existing.telefone
      ? normalizePhoneBrStorage(existing.telefone)
      : telefone;

    await logEvent("casos_novos", existing.id, "caso_reusado_painel", {
      origem: "criarClienteCaso",
      campos: Object.keys(patch),
    });

    revalidatePath("/kanban");
    revalidatePath("/clientes");
    revalidatePath(hrefFor(cpfOut, telOut));

    return {
      success: true,
      casoId: existing.id,
      created: false,
      href: hrefFor(cpfOut, telOut),
      nome: existing.nome?.trim() || nome,
      telefone: telOut,
      cpf: cpfOut,
      status: existing.status ?? status,
      beneficio_identificado:
        existing.beneficio_identificado?.trim() || beneficio,
    };
  }

  const { data: created, error } = await supabase
    .from("casos_novos")
    .insert({
      nome,
      telefone,
      cpf: cpfRaw || null,
      beneficio_identificado: beneficio,
      tipo_segurado: tipoSegurado,
      area,
      status,
    })
    .select(casoSelect)
    .single();

  if (error || !created) {
    throw new Error(error?.message ?? "Falha ao criar caso");
  }

  await logEvent("casos_novos", created.id, "caso_criado_painel", {
    origem: "criarClienteCaso",
    telefone,
    cpf: cpfRaw || null,
  });

  const href = hrefFor(cpfRaw || null, telefone);
  revalidatePath("/kanban");
  revalidatePath("/clientes");
  revalidatePath(href);
  revalidatePath(`/kanban/${created.id}`);

  return {
    success: true,
    casoId: created.id,
    created: true,
    href,
    nome,
    telefone,
    cpf: cpfRaw || null,
    status: created.status ?? status,
    beneficio_identificado: beneficio,
  };
}

/**
 * Cria um novo caso na ficha (sempre INSERT — não reusa caso existente).
 * Cada caso guarda o próprio `beneficio_identificado`.
 */
export async function criarCasoNaFicha(input: {
  nome: string;
  telefone?: string | null;
  cpf?: string | null;
  beneficio_identificado?: string | null;
  status?: CasoStatus;
}): Promise<{ success: true; casoId: number; href: string }> {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const nome = input.nome?.trim() ?? "";
  if (!nome) throw new Error("Nome é obrigatório");

  const telefoneRaw = input.telefone?.trim() ?? "";
  const telefone = telefoneRaw ? normalizePhoneBrStorage(telefoneRaw) : null;
  if (telefone && phoneToContactNorm(telefone).length < 10) {
    throw new Error("Telefone inválido");
  }

  const cpfRaw = input.cpf?.trim() ? normalizeCpf(input.cpf) : "";
  if (cpfRaw) {
    if (cpfRaw.length !== 11 || !isValidCpf(cpfRaw)) {
      throw new Error("CPF inválido");
    }
  }

  if (!telefone && !cpfRaw) {
    throw new Error("Informe CPF ou telefone para vincular o caso");
  }

  const beneficio = input.beneficio_identificado?.trim() || null;
  const statusKey = (input.status ?? "em_atendimento").trim();
  if (!statusKey) throw new Error("Coluna do funil é obrigatória");

  const supabase = await createClient();

  const { data: col } = await supabase
    .from("app_kanban_colunas")
    .select("chave")
    .eq("chave", statusKey)
    .eq("ativo", true)
    .maybeSingle();

  const SYSTEM_KEYS = new Set([
    "em_atendimento",
    "consultar_processo",
    "abertura_processo",
    "aguardando_analise",
    "aguardando_aprovacao",
    "atendimento_humano",
    "processo_finalizado",
  ]);
  if (!col && !SYSTEM_KEYS.has(statusKey)) {
    throw new Error(`Coluna inválida ou inativa: ${statusKey}`);
  }

  const status: CasoStatus = statusKey;

  const { data: created, error } = await supabase
    .from("casos_novos")
    .insert({
      nome,
      telefone,
      cpf: cpfRaw || null,
      beneficio_identificado: beneficio,
      status,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(error?.message ?? "Falha ao criar caso");
  }

  await logEvent("casos_novos", created.id, "caso_criado_ficha", {
    origem: "criarCasoNaFicha",
    telefone,
    cpf: cpfRaw || null,
    beneficio_identificado: beneficio,
  });

  const href = fichaPessoaHref({
    cpf: cpfRaw || null,
    contactNorm: telefone ? phoneToContactNorm(telefone) : null,
    aba: "resumo",
    casoId: created.id,
  });

  revalidatePath("/kanban");
  revalidatePath("/clientes");
  revalidatePath(href);
  revalidatePath(`/kanban/${created.id}`);

  return { success: true, casoId: created.id, href };
}
