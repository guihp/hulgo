import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/actions/auth";
import { getAppConfig } from "@/lib/config/app-config";
import { listTiposCaso } from "@/lib/data/tipos-caso";
import { WhatsAppQrPanel } from "@/components/configuracoes/whatsapp-qr-panel";
import { TiposCasoPanel } from "@/components/configuracoes/tipos-caso-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

  try {
    const [cfg, list] = await Promise.all([
      getAppConfig(),
      listTiposCaso({ includeInactive: true }),
    ]);
    config = cfg;
    tipos = list;
  } catch {
    // Mantém fallbacks: painel WhatsApp e tipos ainda renderizam.
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Conexão WhatsApp, tipos de caso e parâmetros do escritório
        </p>
      </div>

      <WhatsAppQrPanel />

      <TiposCasoPanel initialTipos={tipos} />

      <Card>
        <CardHeader>
          <CardTitle>Parâmetros do sistema</CardTitle>
          <CardDescription>
            Nome do escritório e instância WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Escritório</dt>
              <dd className="font-medium">{config.escritorio_nome || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Instância WhatsApp</dt>
              <dd className="font-medium">{config.whatsapp_instancia || "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
