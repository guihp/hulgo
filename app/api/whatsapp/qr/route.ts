import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/actions/auth";
import { getAppConfig } from "@/lib/config/app-config";
import { ensureInstanceQrCode, getInstanceStatus } from "@/lib/evogo/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QR WhatsApp via Route Handler (não Server Action).
 * Evita serializar base64 no React Flight — em prod isso estourava timeout/500.
 */
export async function GET(req: Request) {
  // #region agent log
  const t0 = Date.now();
  const log = (message: string, data: Record<string, unknown>) => {
    fetch("http://127.0.0.1:7337/ingest/4caa6043-74da-4518-bebb-88b5757877da", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "a9d94c",
      },
      body: JSON.stringify({
        sessionId: "a9d94c",
        runId: "post-fix-qr-api",
        hypothesisId: "F",
        location: "api/whatsapp/qr/route.ts",
        message,
        data: { ...data, ms: Date.now() - t0 },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    console.info("[debug-a9d94c] whatsapp-qr", message, data);
  };
  // #endregion

  try {
    const user = await getAppUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });
    }
    if (user.papel !== "advogado") {
      return NextResponse.json(
        { ok: false, error: "Apenas advogados podem gerenciar o WhatsApp" },
        { status: 403 }
      );
    }

    const url = new URL(req.url);
    const ensure = url.searchParams.get("ensure") === "1";

    // #region agent log
    log("start", { ensure });
    // #endregion

    const config = await getAppConfig();
    const status = await getInstanceStatus();

    if (status.loggedIn) {
      // #region agent log
      log("already logged in", { loggedIn: true });
      // #endregion
      return NextResponse.json({
        ok: true,
        data: {
          instanceName: config.whatsapp_instancia,
          status,
          qrCode: null,
        },
      });
    }

    if (ensure) {
      const ensured = await ensureInstanceQrCode();
      // #region agent log
      log("ensure done", {
        loggedIn: ensured.status.loggedIn,
        hasQr: Boolean(ensured.qrCode?.base64),
        qrLen: ensured.qrCode?.base64?.length ?? 0,
      });
      // #endregion
      return NextResponse.json({
        ok: true,
        data: {
          instanceName: config.whatsapp_instancia,
          status: ensured.status,
          qrCode: ensured.qrCode,
        },
      });
    }

    // #region agent log
    log("status only", { loggedIn: status.loggedIn, connected: status.connected });
    // #endregion
    return NextResponse.json({
      ok: true,
      data: {
        instanceName: config.whatsapp_instancia,
        status,
        qrCode: null,
      },
    });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Erro ao consultar EvoGo";
    // #region agent log
    log("error", { errMsg: msg.slice(0, 300) });
    // #endregion
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
