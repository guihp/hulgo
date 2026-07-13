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

/** Só lê status/QR — não força connect (para polling leve). */
async function peekConnectionState(): Promise<WhatsAppConnectionState> {
  const config = await getAppConfig();
  const status = await getInstanceStatus();
  if (status.loggedIn) {
    return {
      instanceName: config.whatsapp_instancia,
      status,
      qrCode: null,
    };
  }
  const qrCode = await getInstanceQrCode();
  return {
    instanceName: config.whatsapp_instancia,
    status,
    qrCode,
  };
}

export async function getWhatsAppConnection(options?: {
  light?: boolean;
}): Promise<ActionResult<WhatsAppConnectionState>> {
  const auth = await requireAdvogado();
  if (!auth.ok) return auth;

  try {
    const data = options?.light
      ? await peekConnectionState()
      : await buildConnectionState(false);
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
    // EvoGo precisa de um instante após o logout para gerar QR novo
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const data = await buildConnectionState(true);
    // Após logout explícito, força UI de reconexão (status da EvoGo
    // às vezes ainda vem stale com LoggedIn=true por alguns segundos).
    return {
      ok: true,
      data: {
        instanceName: data.instanceName,
        status: {
          connected: data.status.connected,
          loggedIn: false,
          name: "",
        },
        qrCode: data.qrCode,
      },
    };
  } catch (error) {
    return { ok: false, error: formatEvoGoError(error) };
  }
}
