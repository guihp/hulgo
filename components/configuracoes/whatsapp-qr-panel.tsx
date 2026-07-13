"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { LogOut, RefreshCw, Smartphone, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import {
  disconnectWhatsApp,
  getWhatsAppConnection,
  refreshWhatsAppQrCode,
  type WhatsAppConnectionState,
} from "@/lib/actions/evogo";
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
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const QR_REFRESH_MS = 25_000;
const STATUS_POLL_MS = 3_000;

function connectionLabel(status: WhatsAppConnectionState["status"]) {
  if (status.loggedIn) return "Conectado";
  if (status.connected) return "Aguardando leitura do QR";
  return "Desconectado";
}

function connectionVariant(
  status: WhatsAppConnectionState["status"]
): "default" | "secondary" | "destructive" {
  if (status.loggedIn) return "default";
  if (status.connected) return "secondary";
  return "destructive";
}

export function WhatsAppQrPanel() {
  const [state, setState] = useState<WhatsAppConnectionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const ignoreLoggedInUntilRef = useRef(0);

  const loadConnection = useCallback(async (silent = false) => {
    const result = await getWhatsAppConnection({ light: silent });
    if (!result.ok) {
      if (!silent) {
        setError(result.error);
        toast.error(result.error);
      }
      return null;
    }
    setError(null);

    const data = result.data;
    // Evita a UI voltar para "conectado" com status stale logo após desconectar
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
      });
      return data;
    }

    setState(data);
    return data;
  }, []);

  const refreshQr = useCallback(
    (silent = false) => {
      startTransition(async () => {
        const result = await refreshWhatsAppQrCode();
        if (!result.ok) {
          if (!silent) {
            setError(result.error);
            toast.error(result.error);
          }
          return;
        }
        setError(null);
        setState(result.data);
        if (!silent && result.data.qrCode) {
          toast.success("QR Code atualizado");
        } else if (
          !silent &&
          !result.data.qrCode &&
          !result.data.status.loggedIn
        ) {
          toast.message(
            "Aguardando QR Code na EvoGo… tente de novo em alguns segundos"
          );
        }
      });
    },
    [startTransition]
  );

  const handleDisconnect = useCallback(() => {
    // Fecha o popup na hora e mostra a tela de reconexão
    setDisconnectOpen(false);
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
      const result = await disconnectWhatsApp();
      if (!result.ok) {
        ignoreLoggedInUntilRef.current = 0;
        setError(result.error);
        toast.error(result.error);
        // Volta o status real se a desconexão falhou
        await loadConnection();
        return;
      }
      setError(null);
      setState(result.data);
      toast.success(
        "WhatsApp desconectado. Escaneie o QR Code para reconectar."
      );
    });
  }, [loadConnection, startTransition]);

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      await loadConnection();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [loadConnection]);

  // Deps primitivas: o poll de status troca o objeto `state` a cada ciclo e,
  // se os intervals dependessem dele, seriam recriados a cada 3s — o timer de
  // renovação do QR (25s) nunca chegaria a disparar.
  const hasState = state !== null;
  const loggedIn = state?.status.loggedIn ?? false;

  useEffect(() => {
    if (!hasState || loggedIn) return;
    const id = setInterval(() => {
      void loadConnection(true);
    }, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [hasState, loggedIn, loadConnection]);

  useEffect(() => {
    if (!hasState || loggedIn) return;
    const id = setInterval(() => {
      refreshQr(true);
    }, QR_REFRESH_MS);
    return () => clearInterval(id);
  }, [hasState, loggedIn, refreshQr]);

  const qrSrc = state?.qrCode?.base64
    ? state.qrCode.base64.startsWith("data:")
      ? state.qrCode.base64
      : `data:image/png;base64,${state.qrCode.base64}`
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              WhatsApp (EvoGo)
            </CardTitle>
            <CardDescription>
              Leia o QR Code aqui para conectar a instância configurada no servidor.
            </CardDescription>
          </div>
          {state && (
            <Badge variant={connectionVariant(state.status)}>
              {state.status.loggedIn ? (
                <Wifi className="mr-1 h-3 w-3" />
              ) : (
                <WifiOff className="mr-1 h-3 w-3" />
              )}
              {connectionLabel(state.status)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="mx-auto h-64 w-64" />
          </div>
        ) : error && !state ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
            <div className="mt-3">
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => void loadConnection()}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Tentar novamente
              </Button>
            </div>
          </div>
        ) : state ? (
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Instância</dt>
                <dd className="font-medium">{state.instanceName || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Perfil conectado</dt>
                <dd className="font-medium">{state.status.name || "—"}</dd>
              </div>
            </dl>

            {state.status.loggedIn ? (
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                  A instância está autenticada no WhatsApp. Mensagens podem ser
                  enviadas e recebidas normalmente pelo painel.
                </div>

                <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
                  <AlertDialogTrigger
                    disabled={pending}
                    className={cn(
                      buttonVariants({ variant: "destructive" }),
                      "gap-2"
                    )}
                  >
                    <LogOut className="h-4 w-4" />
                    Desconectar número
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Desconectar WhatsApp?</AlertDialogTitle>
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
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Como conectar</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    <li>Abra o WhatsApp no celular</li>
                    <li>Vá em Configurações → Aparelhos conectados</li>
                    <li>Toque em Conectar um aparelho</li>
                    <li>Aponte a câmera para o QR Code abaixo</li>
                  </ol>
                  <p className="mt-3 text-xs">
                    O QR Code expira em cerca de 60 segundos e é renovado
                    automaticamente a cada 25 segundos.
                  </p>
                </div>

                <div className="flex flex-col items-center gap-4">
                  {qrSrc ? (
                    <div className="rounded-xl border bg-white p-4 shadow-sm">
                      <Image
                        src={qrSrc}
                        alt="QR Code WhatsApp EvoGo"
                        width={256}
                        height={256}
                        unoptimized
                        className="h-64 w-64"
                      />
                    </div>
                  ) : (
                    <div className="flex h-64 w-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                      <RefreshCw
                        className={`h-5 w-5 ${pending ? "animate-spin" : ""}`}
                      />
                      <span>
                        {pending
                          ? "Gerando QR Code…"
                          : "QR Code ainda não disponível. Clique em Gerar novo QR Code."}
                      </span>
                    </div>
                  )}

                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => refreshQr(false)}
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${pending ? "animate-spin" : ""}`}
                    />
                    Gerar novo QR Code
                  </Button>
                </div>

                {error && (
                  <p className="text-center text-sm text-destructive">{error}</p>
                )}
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
