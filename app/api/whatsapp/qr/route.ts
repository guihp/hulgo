import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAppConfig } from "@/lib/config/app-config";
import {
  ensureInstanceQrCode,
  getInstanceStatus,
  logoutInstance,
} from "@/lib/evogo/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QrApiOk = {
  ok: true;
  data: {
    instanceName: string;
    status: {
      connected: boolean;
      loggedIn: boolean;
      name: string;
    };
    qrCode: { base64: string; code: string | null } | null;
  };
};

type QrApiErr = { ok: false; error: string };

async function requireAdvogado() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado", status: 401 };

  const { data: profile } = await supabase
    .from("app_usuarios")
    .select("id, papel")
    .eq("id", user.id)
    .eq("ativo", true)
    .maybeSingle();

  if (!profile) {
    return { ok: false as const, error: "Não autenticado", status: 401 };
  }
  if (profile.papel !== "advogado") {
    return {
      ok: false as const,
      error: "Apenas advogados podem gerenciar o WhatsApp",
      status: 403,
    };
  }
  return { ok: true as const };
}

function formatEvoGoError(error: unknown): string {
  if (error instanceof Error) {
    if (/no qr code available/i.test(error.message)) {
      return "QR Code ainda não ficou pronto. Aguarde alguns segundos e tente de novo.";
    }
    if (error.name === "AbortError") {
      return "Timeout ao falar com a EvoGo. Tente de novo.";
    }
    return error.message;
  }
  return "Erro ao consultar EvoGo";
}

/**
 * Status + QR WhatsApp. Sem Server Action / sem React Flight.
 * GET ?ensure=1 → connect + QR; sem ensure → só status.
 */
export async function GET(req: Request) {
  // #region agent log
  const t0 = Date.now();
  const log = (message: string, data: Record<string, unknown>) => {
    console.info("[debug-a9d94c] whatsapp-qr GET", message, {
      ...data,
      ms: Date.now() - t0,
    });
  };
  // #endregion

  try {
    const auth = await requireAdvogado();
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error } satisfies QrApiErr,
        { status: auth.status }
      );
    }

    const url = new URL(req.url);
    const ensure = url.searchParams.get("ensure") === "1";
    // #region agent log
    log("start", {
      ensure,
      hasEvoUrl: Boolean(process.env.EVOGO_API_URL?.trim()),
      hasEvoKey: Boolean(process.env.EVOGO_GLOBAL_API_KEY?.trim()),
      hasInstance: Boolean(process.env.EVOGO_INSTANCE_NAME?.trim()),
    });
    // #endregion

    const config = await getAppConfig();
    const status = await getInstanceStatus();

    if (status.loggedIn) {
      // #region agent log
      log("logged in", {});
      // #endregion
      const body: QrApiOk = {
        ok: true,
        data: {
          instanceName: config.whatsapp_instancia,
          status,
          qrCode: null,
        },
      };
      return NextResponse.json(body);
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
      const body: QrApiOk = {
        ok: true,
        data: {
          instanceName: config.whatsapp_instancia,
          status: ensured.status,
          qrCode: ensured.qrCode,
        },
      };
      return NextResponse.json(body);
    }

    // #region agent log
    log("status only", {
      loggedIn: status.loggedIn,
      connected: status.connected,
    });
    // #endregion
    const body: QrApiOk = {
      ok: true,
      data: {
        instanceName: config.whatsapp_instancia,
        status,
        qrCode: null,
      },
    };
    return NextResponse.json(body);
  } catch (error) {
    const msg = formatEvoGoError(error);
    // #region agent log
    log("error", { errMsg: msg.slice(0, 300) });
    // #endregion
    return NextResponse.json(
      { ok: false, error: msg } satisfies QrApiErr,
      { status: 500 }
    );
  }
}

/** Desconecta o número (logout EvoGo). */
export async function DELETE() {
  // #region agent log
  const t0 = Date.now();
  console.info("[debug-a9d94c] whatsapp-qr DELETE start");
  // #endregion
  try {
    const auth = await requireAdvogado();
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error } satisfies QrApiErr,
        { status: auth.status }
      );
    }

    await logoutInstance();
    const config = await getAppConfig();
    // #region agent log
    console.info("[debug-a9d94c] whatsapp-qr DELETE ok", {
      ms: Date.now() - t0,
    });
    // #endregion
    const body: QrApiOk = {
      ok: true,
      data: {
        instanceName: config.whatsapp_instancia,
        status: { connected: false, loggedIn: false, name: "" },
        qrCode: null,
      },
    };
    return NextResponse.json(body);
  } catch (error) {
    const msg = formatEvoGoError(error);
    // #region agent log
    console.info("[debug-a9d94c] whatsapp-qr DELETE error", {
      errMsg: msg.slice(0, 300),
      ms: Date.now() - t0,
    });
    // #endregion
    return NextResponse.json(
      { ok: false, error: msg } satisfies QrApiErr,
      { status: 500 }
    );
  }
}
