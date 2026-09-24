import { getAppUser } from "@/lib/actions/auth";
import { listParceiros } from "@/lib/actions/parceiros";
import { ClientesList } from "@/components/clientes/clientes-ui";
import { agruparPessoas } from "@/lib/data/pessoas";
import { createClient } from "@/lib/supabase/server";

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ caso?: string }>;
}) {
  const supabase = await createClient();
  const user = await getAppUser();
  const { caso: casoParam } = await searchParams;
  const [{ data: processos }, { data: casos }, parceiros] = await Promise.all([
    supabase.from("processos_clientes").select("*").order("nome"),
    supabase.from("casos_novos").select("*").order("created_at", { ascending: false }),
    listParceiros().catch(() => []),
  ]);

  const casosAbertura = (casos ?? []).filter((c) =>
    [
      "abertura_processo",
      "aguardando_analise",
      "aguardando_advogado",
      "em_analise",
    ].includes(c.status ?? "")
  );

  const pessoas = agruparPessoas(processos ?? [], casos ?? [], parceiros);

  const casoId = Number(casoParam);
  const abrirCaso = Number.isInteger(casoId)
    ? (casos ?? []).find((c) => c.id === casoId) ??
      (
        await supabase
          .from("casos_novos")
          .select("*")
          .eq("id", casoId)
          .maybeSingle()
      ).data
    : null;

  return (
    <ClientesList
      processos={processos ?? []}
      casosAbertura={casosAbertura}
      pessoas={pessoas}
      parceiros={parceiros}
      abrirCaso={abrirCaso}
      user={user!}
    />
  );
}
