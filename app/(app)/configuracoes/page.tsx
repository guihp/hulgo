import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/actions/auth";
import { getAppConfig } from "@/lib/config/app-config";
import { listTiposCaso } from "@/lib/data/tipos-caso";
import { listKanbanColunas } from "@/lib/data/kanban-colunas";
import { listProcessoColunasTodas } from "@/lib/data/processo-colunas";
import {
  getAgenteConfig,
  listEquipe,
  type AgenteConfig,
} from "@/lib/actions/configuracoes";
import { listParceiros, type Parceiro } from "@/lib/actions/parceiros";
import { ConfiguracoesUi } from "@/components/configuracoes/configuracoes-ui";

export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getAppUser();
  if (!user) redirect("/login");
  if (user.papel !== "advogado") redirect("/");

  const { tab } = await searchParams;

  let config = {
    whatsapp_instancia: process.env.EVOGO_INSTANCE_NAME ?? "",
    escritorio_nome: "Boueres e Fonteles Advogados",
    n8n_integracao_token: "",
  };
  let tipos: Awaited<ReturnType<typeof listTiposCaso>> = [];
  let colunas: Awaited<ReturnType<typeof listKanbanColunas>> = [];
  let equipe: Awaited<ReturnType<typeof listEquipe>> = [];
  let agente: AgenteConfig | null = null;
  let parceiros: Parceiro[] = [];
  let processoColunas: Awaited<ReturnType<typeof listProcessoColunasTodas>> = {
    previdenciario: [],
    civel: [],
  };

  try {
    const [
      cfg,
      list,
      cols,
      members,
      agenteCfg,
      parceirosList,
      procCols,
    ] = await Promise.all([
      getAppConfig(),
      listTiposCaso({ includeInactive: true }),
      listKanbanColunas({ includeInactive: true }),
      listEquipe().catch(() => [] as Awaited<ReturnType<typeof listEquipe>>),
      getAgenteConfig().catch(() => null),
      listParceiros().catch(() => [] as Parceiro[]),
      listProcessoColunasTodas({ includeInactive: true }),
    ]);
    processoColunas = procCols;
    config = cfg;
    tipos = list;
    colunas = cols;
    equipe = members;
    agente = agenteCfg;
    parceiros = parceirosList;
  } catch {
    // Mantém fallbacks: painéis ainda renderizam.
  }

  return (
    <ConfiguracoesUi
      config={config}
      tipos={tipos}
      colunas={colunas}
      processoColunas={processoColunas}
      equipe={equipe}
      agente={agente}
      parceiros={parceiros}
      initialTab={tab}
    />
  );
}
