import { createClient } from "@/lib/supabase/server";
import {
  PrazosPageContent,
  type PrazoEnriched,
} from "@/components/prazos/prazos-ui";
import type { Tables } from "@/types/database";

type PrazoLembrete = Tables<"app_prazos_lembretes">;

export default async function PrazosPage() {
  const supabase = await createClient();
  const { data: prazosRaw } = await supabase
    .from("app_prazos")
    .select("*")
    .order("data_prazo", { ascending: true });

  const rows = prazosRaw ?? [];
  const prazoIds = rows.map((p) => p.id);
  const casoIds = [
    ...new Set(
      rows.map((p) => p.caso_id).filter((id): id is number => id != null)
    ),
  ];
  const processoIds = [
    ...new Set(
      rows
        .map((p) => p.processo_id)
        .filter((id): id is number => id != null)
    ),
  ];

  const [casosRes, processosRes, lembretesRes] = await Promise.all([
    casoIds.length
      ? supabase.from("casos_novos").select("id, nome").in("id", casoIds)
      : Promise.resolve({ data: [] as { id: number; nome: string | null }[] }),
    processoIds.length
      ? supabase
          .from("processos_clientes")
          .select("id, numero_processo")
          .in("id", processoIds)
      : Promise.resolve({
          data: [] as { id: number; numero_processo: string }[],
        }),
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
  const processoPorId = new Map(
    (processosRes.data ?? []).map((p) => [p.id, p.numero_processo] as const)
  );
  const lembretesPorPrazo = new Map<number, PrazoLembrete[]>();
  for (const l of lembretesRes.data ?? []) {
    const list = lembretesPorPrazo.get(l.prazo_id) ?? [];
    list.push(l);
    lembretesPorPrazo.set(l.prazo_id, list);
  }

  const prazos: PrazoEnriched[] = rows.map((p) => ({
    ...p,
    cliente_nome: p.caso_id ? (nomePorCaso.get(p.caso_id) ?? null) : null,
    numero_processo: p.processo_id
      ? (processoPorId.get(p.processo_id) ?? null)
      : null,
    lembretes: lembretesPorPrazo.get(p.id) ?? [],
  }));

  return <PrazosPageContent prazos={prazos} />;
}
