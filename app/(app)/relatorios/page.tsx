import { createClient } from "@/lib/supabase/server";
import { RelatoriosPanel } from "@/components/relatorios/relatorios-panel";

export default async function RelatoriosPage() {
  const supabase = await createClient();
  const [{ data: casos }, { data: processos }] = await Promise.all([
    supabase.from("casos_novos").select("*"),
    supabase.from("processos_clientes").select("*"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-muted-foreground">Exportação e relatório mensal</p>
      </div>
      <RelatoriosPanel casos={casos ?? []} processos={processos ?? []} />
    </div>
  );
}
