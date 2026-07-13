import { createClient } from "@/lib/supabase/server";
import { AprovacoesList } from "@/components/aprovacoes/aprovacoes-ui";

export default async function AprovacoesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("aprovacoes_pendentes")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Aprovações</h1>
        <p className="text-muted-foreground">
          Resumos gerados pela IA aguardando sua revisão — o cliente fica com o
          atendimento pausado até a decisão
        </p>
      </div>
      <AprovacoesList initial={data ?? []} />
    </div>
  );
}
