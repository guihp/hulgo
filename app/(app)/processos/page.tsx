import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import { listParceiros, type Parceiro } from "@/lib/actions/parceiros";
import { listProcessoColunas } from "@/lib/data/processo-colunas";
import {
  FUNIL_PROCESSO_PADRAO,
  isFunilProcesso,
  type FunilProcesso,
} from "@/lib/utils/processos";
import { NovoProcessoButton } from "@/components/processos/novo-processo-button";
import { ProcessosBoard } from "@/components/processos/processos-board";
import { ProcessosFunilTabs } from "@/components/processos/processos-funil-tabs";

export default async function ProcessosPage({
  searchParams,
}: {
  searchParams: Promise<{ funil?: string }>;
}) {
  const user = await getAppUser();
  if (!user) redirect("/login");

  const { funil: funilParam } = await searchParams;
  const funil: FunilProcesso = isFunilProcesso(funilParam)
    ? funilParam
    : FUNIL_PROCESSO_PADRAO;

  const supabase = await createClient();
  let query = supabase
    .from("processos_clientes")
    .select("*")
    .order("ultimo_andamento_data", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });
  query =
    funil === FUNIL_PROCESSO_PADRAO
      ? query.or(`area.eq.${funil},area.is.null`)
      : query.eq("area", funil);

  const [{ data: processos }, colunas, parceiros] = await Promise.all([
    query,
    listProcessoColunas(funil),
    listParceiros().catch(() => [] as Parceiro[]),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Processos</h1>
          <p className="text-muted-foreground">
            Funis de processos administrativos e judiciais — arraste os cards entre as fases
          </p>
        </div>
        <NovoProcessoButton funil={funil} />
      </div>
      <ProcessosFunilTabs funil={funil} />
      <ProcessosBoard
        key={funil}
        funil={funil}
        initialProcessos={processos ?? []}
        initialColunas={colunas}
        parceiros={parceiros}
        canManageColunas={user.papel === "advogado"}
        canExcluir={user.papel === "advogado"}
      />
    </div>
  );
}
