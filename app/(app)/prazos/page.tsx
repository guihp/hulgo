import { createClient } from "@/lib/supabase/server";
import {
  PrazosPageContent,
  type PrazoEnriched,
} from "@/components/prazos/prazos-ui";

export default async function PrazosPage() {
  const supabase = await createClient();
  const { data: prazosRaw } = await supabase
    .from("app_prazos")
    .select("*")
    .order("data_prazo", { ascending: true });

  const rows = prazosRaw ?? [];
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

  const [casosRes, processosRes] = await Promise.all([
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
  ]);

  const nomePorCaso = new Map(
    (casosRes.data ?? []).map((c) => [c.id, c.nome] as const)
  );
  const processoPorId = new Map(
    (processosRes.data ?? []).map((p) => [p.id, p.numero_processo] as const)
  );

  const prazos: PrazoEnriched[] = rows.map((p) => ({
    ...p,
    cliente_nome: p.caso_id ? (nomePorCaso.get(p.caso_id) ?? null) : null,
    numero_processo: p.processo_id
      ? (processoPorId.get(p.processo_id) ?? null)
      : null,
  }));

  return <PrazosPageContent prazos={prazos} />;
}
