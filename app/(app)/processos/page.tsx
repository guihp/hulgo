import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import { listParceiros, type Parceiro } from "@/lib/actions/parceiros";
import { listProcessoColunas } from "@/lib/data/processo-colunas";
import { isFunilProcesso, type FunilProcesso } from "@/lib/utils/processos";
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
    : "previdenciario";

  const supabase = await createClient();
  let query = supabase
    .from("processos_clientes")
    .select("*")
    .order("ultimo_andamento_data", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });
  query =
    funil === "previdenciario"
      ? query.or("area.eq.previdenciario,area.is.null")
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
            Funil de processos judiciais — arraste os cards entre as fases
          </p>
        </div>
        <ProcessosFunilTabs funil={funil} />
      </div>
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
