"use server";

import { getAppUser } from "@/lib/actions/auth";
import { getAppConfig } from "@/lib/config/app-config";
import {
  ensureInstanceQrCode,
  getInstanceQrCode,
  getInstanceStatus,
  logoutInstance,
  type EvoGoInstanceStatus,
  type EvoGoQrCode,
} from "@/lib/evogo/client";

export type WhatsAppConnectionState = {
  instanceName: string;
  status: EvoGoInstanceStatus;
  qrCode: EvoGoQrCode | null;
};

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function requireAdvogado() {
  const user = await getAppUser();
  if (!user) return { ok: false as const, error: "Não autenticado" };
  if (user.papel !== "advogado") {
    return {
      ok: false as const,
      error: "Apenas advogados podem gerenciar o WhatsApp",
    };
  }
  return { ok: true as const, user };
}

function formatEvoGoError(error: unknown): string {
  if (error instanceof Error) {
    if (/no qr code available/i.test(error.message)) {
      return "QR Code ainda não ficou pronto. Aguarde alguns segundos e tente de novo.";
    }
    return error.message;
  }
  return "Erro ao consultar EvoGo";
}

async function buildConnectionState(
  preferEnsure = false
): Promise<WhatsAppConnectionState> {
  const config = await getAppConfig();
  const status = await getInstanceStatus();

  if (status.loggedIn) {
    return {
      instanceName: config.whatsapp_instancia,
      status,
      qrCode: null,
    };
  }

  if (preferEnsure) {
    const ensured = await ensureInstanceQrCode();
    return {
      instanceName: config.whatsapp_instancia,
      status: ensured.status,
      qrCode: ensured.qrCode,
    };
  }

  const qrCode = await getInstanceQrCode();
  if (!qrCode) {
    const ensured = await ensureInstanceQrCode();
    return {
      instanceName: config.whatsapp_instancia,
      status: ensured.status,
      qrCode: ensured.qrCode,
    };
  }

  return {
    instanceName: config.whatsapp_instancia,
    status,
    qrCode,
  };
}

/** Só lê status — sem QR (poll leve; evita Server Action gigante com base64). */
async function peekConnectionState(): Promise<WhatsAppConnectionState> {
  const config = await getAppConfig();
  const status = await getInstanceStatus();
  return {
    instanceName: config.whatsapp_instancia,
    status,
    qrCode: null,
  };
}

export async function getWhatsAppConnection(options?: {
  light?: boolean;
}): Promise<ActionResult<WhatsAppConnectionState>> {
  // #region agent log
  const t0 = Date.now();
  const dbg = (message: string, hypothesisId: string, data: Record<string, unknown>) => {
    fetch("http://127.0.0.1:7337/ingest/4caa6043-74da-4518-bebb-88b5757877da", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "a9d94c",
      },
      body: JSON.stringify({
        sessionId: "a9d94c",
        runId: "prod-qr",
        hypothesisId,
        location: "evogo.ts:getWhatsAppConnection",
        message,
        data: { ...data, ms: Date.now() - t0 },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    console.info("[debug-a9d94c]", message, data);
  };
  // #endregion
  try {
    const auth = await requireAdvogado();
    if (!auth.ok) {
      // #region agent log
      dbg("auth failed", "C", { error: auth.error });
      // #endregion
      return auth;
    }

    // #region agent log
    dbg("auth ok, calling evogo", "D", {
      light: Boolean(options?.light),
      hasEvoUrl: Boolean(process.env.EVOGO_API_URL?.trim()),
      hasEvoKey: Boolean(process.env.EVOGO_GLOBAL_API_KEY?.trim()),
      hasInstanceEnv: Boolean(process.env.EVOGO_INSTANCE_NAME?.trim()),
      evoKeyLen: (process.env.EVOGO_GLOBAL_API_KEY ?? "").trim().length,
    });
    // #endregion

    const data = options?.light
      ? await peekConnectionState()
      : await buildConnectionState(false);
    // #region agent log
    dbg("evogo ok", "D", {
      loggedIn: data.status.loggedIn,
      connected: data.status.connected,
      hasQr: Boolean(data.qrCode?.base64),
      instanceLen: data.instanceName.length,
    });
    // #endregion
    return { ok: true, data };
  } catch (error) {
    // #region agent log
    dbg("evogo catch", "D", {
      errMsg:
        error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    });
    // #endregion
    return { ok: false, error: formatEvoGoError(error) };
  }
}

export async function refreshWhatsAppQrCode(): Promise<
  ActionResult<WhatsAppConnectionState>
> {
  const auth = await requireAdvogado();
  if (!auth.ok) return auth;

  try {
    return { ok: true, data: await buildConnectionState(true) };
  } catch (error) {
    return { ok: false, error: formatEvoGoError(error) };
  }
}

export async function disconnectWhatsApp(): Promise<
  ActionResult<WhatsAppConnectionState>
> {
  const auth = await requireAdvogado();
  if (!auth.ok) return auth;

  try {
    // DELETE /instance/logout desvincula o número de verdade.
    // POST /instance/disconnect só fecha o websocket — com alwaysOnline (ou o
    // connect logo abaixo) a sessão religava sozinha e o botão "não funcionava".
    await logoutInstance();
    const data = await peekConnectionState();
    return {
      ok: true,
      data: {
        instanceName: data.instanceName,
        status: {
          connected: false,
          loggedIn: false,
          name: "",
        },
        qrCode: null,
      },
    };
  } catch (error) {
    return { ok: false, error: formatEvoGoError(error) };
  }
}
