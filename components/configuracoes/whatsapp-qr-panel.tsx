"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { LogOut, QrCode, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/utils/dates";

const QR_REFRESH_MS = 25_000;
const STATUS_POLL_MS = 3_000;

const cardShell =
  "rounded-2xl border border-[#e2e8f0] bg-white shadow-none";
const btnPrimary =
  "rounded-full bg-[#0b2148] text-white hover:bg-[#163a7a]";
const btnOutline =
  "rounded-full border-[#e2e8f0] bg-white text-[#0b2148] hover:bg-[#F8FAFC]";

type WhatsAppConnectionState = {
  instanceName: string;
  status: {
    connected: boolean;
    loggedIn: boolean;
    name: string;
  };
  qrCode: { base64: string; code: string | null } | null;
};

type ApiResult =
  | { ok: true; data: WhatsAppConnectionState }
  | { ok: false; error: string };

function connectionLabel(status: WhatsAppConnectionState["status"]) {
  if (status.loggedIn) return "Conectado";
  if (status.connected) return "Aguardando leitura do QR";
  return "Desconectado";
}

function statusBadgeClasses(status: WhatsAppConnectionState["status"]) {
  if (status.loggedIn) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (status.connected) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-rose-200 bg-rose-50 text-rose-700";
}

async function fetchWhatsApp(path: string, init?: RequestInit): Promise<ApiResult> {
  const res = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  let json: ApiResult | null = null;
  try {
    json = (await res.json()) as ApiResult;
  } catch {
    return {
      ok: false,
      error: `Falha HTTP ${res.status} ao consultar WhatsApp`,
    };
  }
  if (!json || typeof json !== "object" || !("ok" in json)) {
    return { ok: false, error: `Resposta inválida (${res.status})` };
  }
  return json;
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-[#F8FAFC] px-3 py-2.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-semibold text-[#0f172a]">
        {value}
      </dd>
    </div>
  );
}

export function WhatsAppQrPanel() {
  const [state, setState] = useState<WhatsAppConnectionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [lastHandshakeAt, setLastHandshakeAt] = useState<string | null>(null);
  const [msgsHoje, setMsgsHoje] = useState<number | null>(null);
  const ignoreLoggedInUntilRef = useRef(0);

  const loadConnection = useCallback(async (options?: {
    silent?: boolean;
  }) => {
    const { silent = false } = options ?? {};
    try {
      const result = await fetchWhatsApp("/api/whatsapp/qr");
      if (!result.ok) {
        if (!silent) {
          setError(result.error);
          toast.error(result.error);
        }
        return null;
      }
      setError(null);
      setLastHandshakeAt(new Date().toISOString());
      const data = result.data;
      if (
        data.status.loggedIn &&
        Date.now() < ignoreLoggedInUntilRef.current
      ) {
        setState({
          ...data,
          status: {
            connected: data.status.connected,
            loggedIn: false,
            name: "",
          },
          qrCode: null,
        });
        return data;
      }
      setState((prev) => {
        if (prev?.qrCode && !data.qrCode) {
          return { ...data, qrCode: prev.qrCode };
        }
        return data;
      });
      return data;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Falha ao consultar WhatsApp";
      if (!silent) {
        setError(msg);
        toast.error(msg);
      }
      return null;
    }
  }, []);

  const refreshQr = useCallback(
    (silent = false) => {
      startTransition(async () => {
        try {
          const json = await fetchWhatsApp("/api/whatsapp/qr?ensure=1");
          if (!json.ok) {
            if (!silent) {
              setError(json.error);
              toast.error(json.error);
            }
            return;
          }
          setError(null);
          setLastHandshakeAt(new Date().toISOString());
          setState(json.data);
          if (!silent && json.data.qrCode) {
            toast.success("QR Code atualizado");
          } else if (
            !silent &&
            !json.data.qrCode &&
            !json.data.status.loggedIn
          ) {
            toast.message(
              "Aguardando QR Code na EvoGo… tente de novo em alguns segundos"
            );
          }
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : "Falha ao gerar QR Code";
          if (!silent) {
            setError(msg);
            toast.error(msg);
          }
        }
      });
    },
    [startTransition]
  );

  const handleShowQr = useCallback(() => {
    setQrVisible(true);
    refreshQr(false);
  }, [refreshQr]);

  const handleDisconnect = useCallback(() => {
    setDisconnectOpen(false);
    setQrVisible(false);
    ignoreLoggedInUntilRef.current = Date.now() + 20_000;
    setState((prev) =>
      prev
        ? {
            ...prev,
            status: {
              connected: false,
              loggedIn: false,
              name: "",
            },
            qrCode: null,
          }
        : prev
    );

    startTransition(async () => {
      const result = await fetchWhatsApp("/api/whatsapp/qr", {
        method: "DELETE",
      });
      if (!result.ok) {
        ignoreLoggedInUntilRef.current = 0;
        setError(result.error);
        toast.error(result.error);
        await loadConnection({ silent: true });
        return;
      }
      setError(null);
      setState({ ...result.data, qrCode: null });
      toast.success(
        "WhatsApp desconectado. Clique em Gerar novo QR Code para reconectar."
      );
    });
  }, [loadConnection, startTransition]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        await loadConnection();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadConnection]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const { count } = await supabase
          .from("mensagens")
          .select("id", { count: "exact", head: true })
          .gte("created_at", start.toISOString());
        if (!cancelled) setMsgsHoje(count ?? 0);
      } catch {
        if (!cancelled) setMsgsHoje(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasState = state !== null;
  const loggedIn = state?.status.loggedIn ?? false;
  const polling = qrVisible && hasState && !loggedIn;

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => {
      void loadConnection({ silent: true });
    }, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [polling, loadConnection]);

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => {
      refreshQr(true);
    }, QR_REFRESH_MS);
    return () => clearInterval(id);
  }, [polling, refreshQr]);

  const qrSrc =
    qrVisible && state?.qrCode?.base64
      ? state.qrCode.base64.startsWith("data:")
        ? state.qrCode.base64
        : `data:image/png;base64,${state.qrCode.base64}`
      : null;

  const showQrColumn = !loggedIn && (qrVisible || !state?.status.loggedIn);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
      <section className={cn(cardShell, "p-5 sm:p-6")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#0b2148]">
              WhatsApp via EvoGo
            </h2>
            <p className="mt-0.5 text-sm text-[#64748b]">
              Canal por onde o agente conversa com os clientes.
            </p>
          </div>
          {state && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                statusBadgeClasses(state.status)
              )}
            >
              {state.status.loggedIn ? (
                <Wifi className="size-3.5" />
              ) : (
                <WifiOff className="size-3.5" />
              )}
              {connectionLabel(state.status)}
            </span>
          )}
        </div>

        {loading ? (
          <div className="mt-5 space-y-3">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : error && !state ? (
          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
            <div className="mt-3">
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                className={btnOutline}
                onClick={() => void loadConnection()}
              >
                <RefreshCw className="size-4" />
                Tentar novamente
              </Button>
            </div>
          </div>
        ) : state ? (
          <>
            <dl className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <InfoBox
                label="Instância"
                value={state.instanceName || "—"}
              />
              <InfoBox
                label="Perfil conectado"
                value={state.status.name || "nenhum"}
              />
              <InfoBox
                label="Último handshake"
                value={
                  lastHandshakeAt
                    ? formatRelative(lastHandshakeAt)
                    : "—"
                }
              />
              <InfoBox
                label="Mensagens hoje"
                value={msgsHoje === null ? "—" : String(msgsHoje)}
              />
            </dl>

            {state.status.loggedIn ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-900">
                  A instância está autenticada no WhatsApp. Mensagens podem ser
                  enviadas e recebidas normalmente pelo painel.
                </div>
                <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
                  <AlertDialogTrigger
                    disabled={pending}
                    className={cn(
                      buttonVariants({ variant: "destructive" }),
                      "gap-2 rounded-full"
                    )}
                  >
                    <LogOut className="size-4" />
                    Desconectar número
                  </AlertDialogTrigger>
                  <AlertDialogContent className="border-[#e2e8f0] bg-white">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-[#0b2148]">
                        Desconectar WhatsApp?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        O número{" "}
                        <strong>{state.status.name || "conectado"}</strong> será
                        desvinculado desta instância. O envio e o recebimento de
                        mensagens pelo painel param até um novo QR Code ser
                        lido.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={pending}>
                        Cancelar
                      </AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        disabled={pending}
                        onClick={(e) => {
                          e.preventDefault();
                          handleDisconnect();
                        }}
                      >
                        {pending ? "Desconectando…" : "Desconectar"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800">
                  Leia o QR Code ao lado no WhatsApp do escritório (Aparelhos
                  conectados) para reativar o atendimento.
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={pending}
                    className={btnPrimary}
                    onClick={handleShowQr}
                  >
                    <QrCode className="size-4" />
                    {pending && qrVisible
                      ? "Gerando…"
                      : "Gerar novo QR Code"}
                  </Button>
                  {qrVisible ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      disabled={pending}
                      className={btnOutline}
                      onClick={() => refreshQr(false)}
                    >
                      <RefreshCw className="size-4" />
                      Atualizar QR
                    </Button>
                  ) : null}
                </div>
                {error ? (
                  <p className="text-sm text-rose-600">{error}</p>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <p className="mt-5 text-sm text-[#64748b]">
            Não foi possível carregar o status do WhatsApp.
          </p>
        )}
      </section>

      <section className={cn(cardShell, "flex flex-col p-5 sm:p-6")}>
        <h2 className="text-xs font-bold uppercase tracking-wide text-[#94a3b8]">
          QR Code
        </h2>
        <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-3">
          {loggedIn ? (
            <div className="flex aspect-square w-full max-w-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#e2e8f0] bg-[#F8FAFC] p-6 text-center text-sm text-[#64748b]">
              Número já conectado. Desconecte para gerar um novo QR.
            </div>
          ) : !showQrColumn || !qrVisible ? (
            <div className="flex aspect-square w-full max-w-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#e2e8f0] bg-[#F8FAFC] p-6 text-center text-sm text-[#64748b]">
              Clique em <strong className="text-[#0b2148]">Gerar novo QR Code</strong>{" "}
              para exibir o pareamento.
            </div>
          ) : qrSrc ? (
            <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
              <Image
                src={qrSrc}
                alt="QR Code WhatsApp EvoGo"
                width={256}
                height={256}
                unoptimized
                className="size-56"
              />
            </div>
          ) : (
            <div className="flex aspect-square w-full max-w-[260px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#e2e8f0] bg-[#F8FAFC] p-6 text-center text-sm text-[#64748b]">
              <RefreshCw
                className={cn("size-5", pending && "animate-spin")}
              />
              {pending ? "Gerando QR Code…" : "QR ainda não disponível"}
            </div>
          )}
          <p className="text-center text-xs text-[#94a3b8]">
            Válido por 60 segundos. Gere outro se expirar.
          </p>
        </div>
      </section>
    </div>
  );
}
