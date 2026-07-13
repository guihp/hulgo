import { createClient } from "@/lib/supabase/server";
import { PrazosList, NovoPrazoDialog } from "@/components/prazos/prazos-ui";

export default async function PrazosPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_prazos")
    .select("*")
    .order("data_prazo", { ascending: true });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Prazos</h1>
          <p className="text-muted-foreground">
            Exigências do INSS, recursos, perícias e audiências
          </p>
        </div>
        <NovoPrazoDialog />
      </div>
      <PrazosList prazos={data ?? []} />
    </div>
  );
}
