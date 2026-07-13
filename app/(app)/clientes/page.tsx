import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import { ClientesList } from "@/components/clientes/clientes-ui";

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ caso?: string }>;
}) {
  const supabase = await createClient();
  const user = await getAppUser();
  const { caso: casoParam } = await searchParams;
  const [{ data: processos }, { data: casosAbertura }] = await Promise.all([
    supabase.from("processos_clientes").select("*").order("nome"),
    // status legado do n8n (aguardando_advogado/em_analise) = abertura_processo
    supabase
      .from("casos_novos")
      .select("*")
      .in("status", ["abertura_processo", "aguardando_advogado", "em_analise"])
      .order("created_at", { ascending: false }),
  ]);

  // /clientes?caso=ID (botão "Criar processo" do Kanban) abre o cadastro
  // pré-preenchido com os dados do caso
  const casoId = Number(casoParam);
  const abrirCaso = Number.isInteger(casoId)
    ? (
        await supabase
          .from("casos_novos")
          .select("*")
          .eq("id", casoId)
          .maybeSingle()
      ).data
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Clientes e processos</h1>
        <p className="text-muted-foreground">
          Cadastro de clientes com processo — base da consulta por CPF da IA
        </p>
      </div>
      <ClientesList
        processos={processos ?? []}
        casosAbertura={casosAbertura ?? []}
        abrirCaso={abrirCaso}
        user={user!}
      />
    </div>
  );
}
