import { createClient } from "@/lib/supabase/server";
import {
  PrazosPageContent,
  type PrazoEnriched,
  type PrazoProcessoOption,
} from "@/components/prazos/prazos-ui";
import type { Tables } from "@/types/database";

type PrazoLembrete = Tables<"app_prazos_lembretes">;

export default async function AudienciasPage() {
  const supabase = await createClient();
  const [audienciasRes, processosRes] = await Promise.all([
    supabase
      .from("app_prazos")
      .select("*")
      .eq("tipo", "audiencia")
      .order("data_prazo", { ascending: true }),
    supabase
      .from("processos_clientes")
      .select("id, numero_processo, nome, cpf, ativo")
      .order("nome", { ascending: true }),
  ]);

  if (audienciasRes.error) {
    console.error("[audiencias/page] select", audienciasRes.error.message);
    throw new Error(
      `Não foi possível carregar audiências: ${audienciasRes.error.message}`
    );
  }

  const rows = audienciasRes.data ?? [];
  const processos = processosRes.data ?? [];
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

  const audiencias: PrazoEnriched[] = rows.map((p) => {
    const processo = p.processo_id ? processoPorId.get(p.processo_id) : undefined;
    return {
      ...p,
      cliente_nome:
        (p.caso_id ? nomePorCaso.get(p.caso_id) : null) ??
        processo?.nome ??
        (p.cpf ? nomePorCpf.get(p.cpf) : null) ??
        null,
      numero_processo: processo?.numero_processo ?? null,
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

  return (
    <PrazosPageContent
      prazos={audiencias}
      mode="audiencias"
      processos={processoOptions}
    />
  );
}
