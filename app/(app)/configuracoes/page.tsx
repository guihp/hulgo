import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/actions/auth";
import { getAppConfig } from "@/lib/config/app-config";
import { listTiposCaso } from "@/lib/data/tipos-caso";
import {
  getAgenteConfig,
  listEquipe,
  type AgenteConfig,
} from "@/lib/actions/configuracoes";
import { listParceiros, type Parceiro } from "@/lib/actions/parceiros";
import { ConfiguracoesUi } from "@/components/configuracoes/configuracoes-ui";

export default async function ConfiguracoesPage() {
  const user = await getAppUser();
  if (!user) redirect("/login");
  if (user.papel !== "advogado") redirect("/");

  let config = {
    whatsapp_instancia: process.env.EVOGO_INSTANCE_NAME ?? "",
    escritorio_nome: "Boueres e Fonteles Advogados",
    n8n_integracao_token: "",
  };
  let tipos: Awaited<ReturnType<typeof listTiposCaso>> = [];
  let equipe: Awaited<ReturnType<typeof listEquipe>> = [];
  let agente: AgenteConfig | null = null;
  let parceiros: Parceiro[] = [];

  try {
    const [cfg, list, members, agenteCfg, parceirosList] = await Promise.all([
      getAppConfig(),
      listTiposCaso({ includeInactive: true }),
      listEquipe().catch(() => [] as Awaited<ReturnType<typeof listEquipe>>),
      getAgenteConfig().catch(() => null),
      listParceiros().catch(() => [] as Parceiro[]),
    ]);
    config = cfg;
    tipos = list;
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
      equipe={equipe}
      agente={agente}
      parceiros={parceiros}
    />
  );
}
