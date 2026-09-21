"use server";

import { getAppUser } from "@/lib/actions/auth";
import { getAppConfig } from "@/lib/config/app-config";
import {
  ensureInstanceQrCode,
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
  try {
    const auth = await requireAdvogado();
    if (!auth.ok) return auth;

    void options?.light;
    const data = await peekConnectionState();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: formatEvoGoError(error) };
  }
}

export async function refreshWhatsAppQrCode(): Promise<
  ActionResult<WhatsAppConnectionState>
> {
  const auth = await requireAdvogado();
  if (!auth.ok) return auth;

  try {
    // Só prepara a sessão na EvoGo — QR base64 vem de GET /api/whatsapp/qr
    // (Server Action + base64 estourava timeout em produção).
    const config = await getAppConfig();
    const ensured = await ensureInstanceQrCode();
    return {
      ok: true,
      data: {
        instanceName: config.whatsapp_instancia,
        status: ensured.status,
        qrCode: null,
      },
    };
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
