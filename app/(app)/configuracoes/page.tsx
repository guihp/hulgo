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
  // #region agent log
  const t0 = Date.now();
  // #endregion
  const user = await getAppUser();
  if (!user) redirect("/login");
  if (user.papel !== "advogado") redirect("/");

  try {
    const [config, tipos] = await Promise.all([
      getAppConfig(),
      listTiposCaso({ includeInactive: true }),
    ]);
    // #region agent log
    fetch("http://127.0.0.1:7337/ingest/4caa6043-74da-4518-bebb-88b5757877da", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "a9d94c",
      },
      body: JSON.stringify({
        sessionId: "a9d94c",
        runId: "prod-qr",
        hypothesisId: "E",
        location: "configuracoes/page.tsx:ok",
        message: "config page data loaded",
        data: {
          ms: Date.now() - t0,
          tiposCount: tipos.length,
          hasInstancia: Boolean(config.whatsapp_instancia),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    console.info("[debug-a9d94c] configuracoes page ok", {
      tiposCount: tipos.length,
      ms: Date.now() - t0,
    });
    // #endregion

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
  } catch (error) {
    // #region agent log
    console.error("[debug-a9d94c] configuracoes page fail", error);
    fetch("http://127.0.0.1:7337/ingest/4caa6043-74da-4518-bebb-88b5757877da", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "a9d94c",
      },
      body: JSON.stringify({
        sessionId: "a9d94c",
        runId: "prod-qr",
        hypothesisId: "E",
        location: "configuracoes/page.tsx:fail",
        message: "config page data failed",
        data: {
          ms: Date.now() - t0,
          errMsg:
            error instanceof Error
              ? error.message.slice(0, 300)
              : String(error).slice(0, 300),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw error;
  }
}
