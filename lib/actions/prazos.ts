"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import { normalizeCpf } from "@/lib/utils/cpf";
import type { PrazoTipo } from "@/types/database";
import {
  isModalidadeAudiencia,
  type ModalidadeAudiencia,
} from "@/lib/utils/processos";
import {
  labelForOffset,
  normalizeHoraPrazo,
  type LembreteInput,
} from "@/lib/prazos/lembretes";

export type NovoPrazoInput = {
  titulo: string;
  tipo: PrazoTipo;
  data_prazo: string; // yyyy-mm-dd
  /** HH:MM ou HH:MM:SS (America/Sao_Paulo). Obrigatório em novos prazos. */
  hora_prazo: string;
  descricao?: string;
  /** Se omitido/vazio → default 1h antes + na hora */
  lembretes?: LembreteInput[];
  cpf?: string;
  caso_id?: number;
  processo_id?: number;
  /** Só tipo = 'pagamento'. */
  valor_centavos?: number | null;
} & AudienciaCamposInput;

export type AtualizarPrazoInput = {
  id: number;
  titulo: string;
  tipo: PrazoTipo;
  data_prazo: string;
  hora_prazo: string;
  descricao?: string;
  lembretes?: LembreteInput[];
  /** Omitido = mantém; null/0 = remove vínculo */
  processo_id?: number | null;
  /** Só tipo = 'pagamento'. Omitido = mantém. */
  valor_centavos?: number | null;
} & AudienciaCamposInput;

/** Usados quando tipo = 'audiencia'. Omitido no update = mantém o valor atual. */
export type AudienciaCamposInput = {
  local?: string | null;
  modalidade?: ModalidadeAudiencia | null;
  link_audiencia?: string | null;
};

function audienciaCampos(input: AudienciaCamposInput) {
  const out: {
    local?: string | null;
    modalidade?: ModalidadeAudiencia | null;
    link_audiencia?: string | null;
  } = {};
  if (input.local !== undefined) out.local = input.local?.trim() || null;
  if (input.modalidade !== undefined) {
    const m = input.modalidade || null;
    if (m !== null && !isModalidadeAudiencia(m)) {
      throw new Error(`Modalidade inválida: ${m}`);
    }
    out.modalidade = m;
  }
  if (input.link_audiencia !== undefined) {
    const link = input.link_audiencia?.trim() || null;
    if (link && !/^https?:\/\//i.test(link)) {
      throw new Error("Link da audiência deve começar com http:// ou https://");
    }
    out.link_audiencia = link;
  }
  return out;
}

const DEFAULT_LEMBRETE_INPUTS: LembreteInput[] = [
  { offset_minutes: 60, label: "1 hora antes" },
  { offset_minutes: 0, label: "Somente no horário" },
];

function revalidatePrazos() {
  revalidatePath("/prazos");
  revalidatePath("/audiencias");
  revalidatePath("/pagamentos");
}

/** Valor em centavos (só pagamentos); outros tipos sempre null. */
function valorPagamento(
  tipo: PrazoTipo,
  valor: number | null | undefined
): { valor_centavos?: number | null } {
  if (tipo !== "pagamento") return { valor_centavos: null };
  if (valor === undefined) return {};
  if (valor === null) return { valor_centavos: null };
  if (!Number.isInteger(valor) || valor < 0) throw new Error("Valor do pagamento inválido");
  return { valor_centavos: valor };
}

function assertDataPrazo(data: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new Error("Data do prazo inválida");
  }
}

function assertHoraPrazo(hora: string): string {
  const n = normalizeHoraPrazo(hora);
  if (!n) throw new Error("Horário do prazo inválido");
  return n;
}

function normalizeLembretes(
  input: LembreteInput[] | undefined
): LembreteInput[] {
  if (!input || !Array.isArray(input) || input.length === 0) {
    return DEFAULT_LEMBRETE_INPUTS;
  }
  const seen = new Set<number>();
  const out: LembreteInput[] = [];
  for (const raw of input) {
    const offset = Math.max(0, Math.floor(Number(raw.offset_minutes)));
    if (!Number.isFinite(offset) || seen.has(offset)) continue;
    seen.add(offset);
    out.push({
      offset_minutes: offset,
      label: raw.label?.trim() || labelForOffset(offset),
    });
  }
  return out.length ? out : DEFAULT_LEMBRETE_INPUTS;
}

async function replaceLembretes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  prazoId: number,
  lembretes: LembreteInput[]
) {
  const { error: delErr } = await supabase
    .from("app_prazos_lembretes")
    .delete()
    .eq("prazo_id", prazoId);
  if (delErr) throw new Error(delErr.message);

  const rows = lembretes.map((l) => ({
    prazo_id: prazoId,
    offset_minutes: l.offset_minutes,
    label: l.label ?? labelForOffset(l.offset_minutes),
  }));

  const { error: insErr } = await supabase
    .from("app_prazos_lembretes")
    .insert(rows);
  if (insErr) throw new Error(insErr.message);
}

export async function criarPrazo(input: NovoPrazoInput) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  if (!input.titulo.trim()) throw new Error("Título é obrigatório");
  assertDataPrazo(input.data_prazo);
  const horaPrazo = assertHoraPrazo(input.hora_prazo);
  const lembretes = normalizeLembretes(input.lembretes);
  const audiencia = audienciaCampos(input);
  const valor = valorPagamento(input.tipo, input.valor_centavos);

  // Optional FKs: omit empty/0 so inserts without vínculo don't hit *_fkey.
  const cpfNorm = input.cpf?.trim() ? normalizeCpf(input.cpf) : null;
  const casoId =
    typeof input.caso_id === "number" && input.caso_id > 0
      ? input.caso_id
      : null;
  const processoId =
    typeof input.processo_id === "number" && input.processo_id > 0
      ? input.processo_id
      : null;

  const supabase = await createClient();
  const { data: criado, error } = await supabase
    .from("app_prazos")
    .insert({
      titulo: input.titulo.trim(),
      tipo: input.tipo,
      data_prazo: input.data_prazo,
      hora_prazo: horaPrazo,
      descricao: input.descricao?.trim() || null,
      lembrar_em: null,
      cpf: cpfNorm || null,
      caso_id: casoId,
      processo_id: processoId,
      criado_por: user.id,
      ...audiencia,
      ...valor,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[criarPrazo] insert", error.code, error.message, error.details);
    throw new Error(error.message || "Falha ao criar prazo");
  }
  if (!criado?.id) throw new Error("Falha ao criar prazo");

  try {
    await replaceLembretes(supabase, criado.id, lembretes);
  } catch (e) {
    console.error("[criarPrazo] lembretes", e);
    // Prazo já existe — remove para não deixar órfão sem lembretes configuráveis
    await supabase.from("app_prazos").delete().eq("id", criado.id);
    throw e instanceof Error ? e : new Error("Falha ao salvar lembretes");
  }

  revalidatePrazos();
  return { success: true, id: criado.id };
}

export async function atualizarPrazo(input: AtualizarPrazoInput) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  if (!input.id || input.id <= 0) throw new Error("Prazo inválido");
  if (!input.titulo.trim()) throw new Error("Título é obrigatório");
  assertDataPrazo(input.data_prazo);
  const horaPrazo = assertHoraPrazo(input.hora_prazo);
  const lembretes = normalizeLembretes(input.lembretes);
  const audiencia = audienciaCampos(input);
  const valor = valorPagamento(input.tipo, input.valor_centavos);
  const processoPatch =
    input.processo_id === undefined
      ? {}
      : {
          processo_id:
            typeof input.processo_id === "number" && input.processo_id > 0
              ? input.processo_id
              : null,
        };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_prazos")
    .update({
      titulo: input.titulo.trim(),
      tipo: input.tipo,
      data_prazo: input.data_prazo,
      hora_prazo: horaPrazo,
      descricao: input.descricao?.trim() || null,
      lembrar_em: null,
      ...processoPatch,
      ...audiencia,
      ...valor,
    })
    .eq("id", input.id);

  if (error) throw new Error(error.message);

  await replaceLembretes(supabase, input.id, lembretes);

  revalidatePrazos();
  return { success: true };
}

export async function concluirPrazo(id: number, concluido: boolean) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_prazos")
    .update({
      concluido,
      concluido_em: concluido ? new Date().toISOString() : null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePrazos();
  return { success: true };
}

export async function excluirPrazo(id: number) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const supabase = await createClient();
  const { error } = await supabase.from("app_prazos").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePrazos();
  return { success: true };
}

/** Processa lembretes vencidos (mesmo fluxo do cron). Para tick no app aberto. */
export async function tickLembretesPrazos() {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  const { processarLembretesPrazos } = await import("@/lib/prazos/notificar");
  return processarLembretesPrazos();
}
