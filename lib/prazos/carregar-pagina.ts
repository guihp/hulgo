import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";
import type {
  PrazoEnriched,
  PrazoParceiroOption,
  PrazoProcessoOption,
} from "@/components/prazos/prazos-ui";
import { todaySaoPauloIso } from "@/lib/prazos/calendario";

type PrazoLembrete = Tables<"app_prazos_lembretes">;

/** Dados das telas /prazos e /audiencias (calendário + filtros). */
export async function carregarPrazosPagina({
  somenteAudiencias = false,
}: { somenteAudiencias?: boolean } = {}) {
  const supabase = await createClient();

  let prazosQuery = supabase
    .from("app_prazos")
    .select("*")
    .order("data_prazo", { ascending: true });
  if (somenteAudiencias) prazosQuery = prazosQuery.eq("tipo", "audiencia");

  const [prazosRes, processosRes, parceirosRes] = await Promise.all([
    prazosQuery,
    supabase
      .from("processos_clientes")
      .select("id, numero_processo, nome, cpf, ativo, parceiro_id")
      .order("nome", { ascending: true }),
    supabase
      .from("app_parceiros")
      .select("id, nome")
      .order("nome", { ascending: true }),
  ]);

  if (prazosRes.error) {
    const oque = somenteAudiencias ? "audiências" : "prazos";
    console.error("[prazos/carregar-pagina] select", prazosRes.error.message);
    throw new Error(
      `Não foi possível carregar ${oque}: ${prazosRes.error.message}`
    );
  }
  if (processosRes.error) {
    console.error("[prazos/carregar-pagina] processos", processosRes.error.message);
  }
  if (parceirosRes.error) {
    console.error("[prazos/carregar-pagina] parceiros", parceirosRes.error.message);
  }

  const rows = prazosRes.data ?? [];
  const processos = processosRes.data ?? [];
  const parceiros: PrazoParceiroOption[] = parceirosRes.data ?? [];
  const prazoIds = rows.map((p) => p.id);
  const casoIds = [
    ...new Set(
      rows.map((p) => p.caso_id).filter((id): id is number => id != null)
    ),
  ];

  const [casosRes, lembretesRes] = await Promise.all([
    casoIds.length
      ? supabase.from("casos_novos").select("id, nome").in("id", casoIds)
      : Promise.resolve({ data: [] as { id: number; nome: string | null }[] }),
    prazoIds.length
      ? supabase
          .from("app_prazos_lembretes")
          .select("*")
          .in("prazo_id", prazoIds)
          .order("offset_minutes", { ascending: false })
      : Promise.resolve({ data: [] as PrazoLembrete[] }),
  ]);

  const nomePorCaso = new Map(
    (casosRes.data ?? []).map((c) => [c.id, c.nome] as const)
  );
  const processoPorId = new Map(processos.map((p) => [p.id, p] as const));
  const parceiroPorId = new Map(parceiros.map((p) => [p.id, p.nome] as const));
  const nomePorCpf = new Map<string, string>();
  for (const p of processos) {
    if (p.cpf && p.nome && !nomePorCpf.has(p.cpf)) nomePorCpf.set(p.cpf, p.nome);
  }
  const lembretesPorPrazo = new Map<number, PrazoLembrete[]>();
  for (const l of lembretesRes.data ?? []) {
    const list = lembretesPorPrazo.get(l.prazo_id) ?? [];
    list.push(l);
    lembretesPorPrazo.set(l.prazo_id, list);
  }

  const prazos: PrazoEnriched[] = rows.map((p) => {
    const processo = p.processo_id ? processoPorId.get(p.processo_id) : undefined;
    const parceiroId = processo?.parceiro_id ?? null;
    return {
      ...p,
      cliente_nome:
        (p.caso_id ? nomePorCaso.get(p.caso_id) : null) ??
        processo?.nome ??
        (p.cpf ? nomePorCpf.get(p.cpf) : null) ??
        null,
      numero_processo: processo?.numero_processo ?? null,
      parceiro_id: parceiroId,
      parceiro_nome: parceiroId ? (parceiroPorId.get(parceiroId) ?? null) : null,
      lembretes: lembretesPorPrazo.get(p.id) ?? [],
    };
  });

  const processoOptions: PrazoProcessoOption[] = processos
    .filter((p) => p.ativo !== false)
    .map((p) => ({
      id: p.id,
      numero_processo: p.numero_processo,
      nome: p.nome,
      cpf: p.cpf,
    }));

  return {
    prazos,
    processos: processoOptions,
    parceiros,
    todayIso: todaySaoPauloIso(),
  };
}
