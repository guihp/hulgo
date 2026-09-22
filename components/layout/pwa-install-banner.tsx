"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/components/providers/pwa-install-provider";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "pwa-install-banner-dismissed";

export function PwaInstallBanner() {
  const { canInstall, busy, install, isInstalled } = usePwaInstall();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (isInstalled || !canInstall || dismissed) return null;

  async function onInstall() {
    const outcome = await install();
    if (outcome === "accepted") {
      toast.success("App instalado — abra pela tela inicial");
    } else if (outcome === "dismissed") {
      toast.message("Instalação cancelada");
    } else {
      toast.error("Não foi possível abrir a instalação agora");
    }
  }

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  return (
    <div
      className={cn(
        "fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-sm",
        "flex items-start gap-3 rounded-2xl border border-[#0b2148]/15 bg-white p-3 shadow-lg"
      )}
      role="status"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0b2148]/8 text-[#0b2148]">
        <Download className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#0b2148]">
          Instalar o app no celular
        </p>
        <p className="mt-0.5 text-xs text-[#64748b]">
          Abre como aplicativo e facilita as notificações.
        </p>
        <Button
          type="button"
          size="sm"
          className="mt-2 bg-[#0b2148] text-white hover:bg-[#0b2148]/90"
          disabled={busy}
          onClick={() => void onInstall()}
        >
          <Download className="size-3.5" />
          {busy ? "Abrindo…" : "Instalar agora"}
        </Button>
      </div>
      <button
        type="button"
        aria-label="Dispensar"
        className="rounded-md p-1 text-[#94a3b8] hover:bg-muted hover:text-foreground"
        onClick={dismiss}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
