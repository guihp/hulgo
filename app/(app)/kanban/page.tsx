import { createClient } from "@/lib/supabase/server";
import { getContactNameMap } from "@/lib/data/contact-names";
import { getDadosClienteNameMap } from "@/lib/data/dados-cliente-names";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import {
  buildAprovacaoPorContato,
  buildClientePorTelefone,
} from "@/lib/data/kanban-lookups";

export default async function KanbanPage() {
  const supabase = await createClient();
  const [{ data: casos }, { data: aprovacoes }, { data: processos }, contactNames, dadosClienteNames] =
    await Promise.all([
      supabase
        .from("casos_novos")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("aprovacoes_pendentes")
        .select("id, telefone_cliente, cpf, status")
        .order("created_at", { ascending: false }),
      supabase.from("processos_clientes").select("telefone, cpf"),
      getContactNameMap(supabase),
      getDadosClienteNameMap(),
    ]);

  const displayNames = { ...dadosClienteNames, ...contactNames };
  const aprovacaoPorContato = buildAprovacaoPorContato(aprovacoes ?? []);
  const clientePorTelefone = buildClientePorTelefone(processos ?? []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Funil de atendimento</h1>
        <p className="text-muted-foreground">
          Kanban do funil — arraste ou use os botões para mover
        </p>
      </div>
      <KanbanBoard
        initialCasos={casos ?? []}
        displayNames={displayNames}
        initialAprovacaoPorContato={aprovacaoPorContato}
        initialClientePorTelefone={clientePorTelefone}
      />
    </div>
  );
}
