import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/actions/auth";
import { getAppConfig } from "@/lib/config/app-config";
import { WhatsAppQrPanel } from "@/components/configuracoes/whatsapp-qr-panel";
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

  const config = await getAppConfig();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Conexão WhatsApp e parâmetros do escritório
        </p>
      </div>

      <WhatsAppQrPanel />

      <Card>
        <CardHeader>
          <CardTitle>Parâmetros do sistema</CardTitle>
          <CardDescription>
            Valores gravados em <code>app_config</code>. Credenciais EvoGo ficam
            apenas no servidor (<code>EVOGO_*</code>).
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
