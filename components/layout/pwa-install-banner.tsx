"use client";

/**
 * CTA de instalação PWA — padrão sys_iza:
 * botão no cabeçalho (desktop) + faixa inferior (mobile) só quando
 * `beforeinstallprompt` dispara; no iOS, faixa com instrução.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { usePwaInstall } from "@/components/providers/pwa-install-provider";
import { cn } from "@/lib/utils";

const classeCabecalho =
  "inline-flex min-h-9 items-center justify-center rounded-lg border border-[#0b2148]/25 bg-[#0b2148]/5 px-3 py-2 text-sm font-medium text-[#0b2148] transition-colors hover:bg-[#0b2148]/10";

const faixaMobile =
  "fixed inset-x-0 bottom-0 z-40 border-t border-[#e2e8f0] bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] lg:hidden";

export function PwaInstallBanner() {
  const { canNativeInstall, isInstalled, isIos, busy, install } =
    usePwaInstall();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem("pwa-install-banner-dismissed") === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (isInstalled || dismissed) return null;

  function dismiss() {
    try {
      sessionStorage.setItem("pwa-install-banner-dismissed", "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  async function onInstall() {
    const outcome = await install();
    if (outcome === "accepted") {
      toast.success("App instalado — abra pela tela inicial");
    } else if (outcome === "dismissed") {
      toast.message("Instalação cancelada");
    }
  }

  if (canNativeInstall) {
    return (
      <>
        <button
          type="button"
          className={cn("hidden lg:inline-flex", classeCabecalho)}
          disabled={busy}
          onClick={() => void onInstall()}
        >
          {busy ? "Abrindo…" : "Instalar app"}
        </button>
        <div className={faixaMobile} role="region" aria-label="Instalar aplicativo">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0b2148] px-4 text-[15px] font-medium text-white"
            disabled={busy}
            onClick={() => void onInstall()}
          >
            {busy ? "Abrindo…" : "Instalar na tela inicial"}
          </button>
          <button
            type="button"
            className="mt-2 w-full py-2 text-center text-[13px] text-[#64748b] underline"
            onClick={dismiss}
          >
            Agora não
          </button>
        </div>
      </>
    );
  }

  if (isIos) {
    return (
      <div className={faixaMobile} role="region" aria-label="Como instalar no iPhone">
        <p className="text-[14px] leading-snug text-[#0b2148]">
          <span className="font-medium">Instalar no iPhone</span>
          <span className="mt-1 block text-[#64748b]">
            Toque em Compartilhar → Adicionar à Tela de Início
          </span>
        </p>
        <button
          type="button"
          className="mt-3 min-h-11 w-full rounded-xl border border-[#e2e8f0] px-4 text-[14px] text-[#64748b]"
          onClick={dismiss}
        >
          Entendi
        </button>
      </div>
    );
  }

  return null;
}
