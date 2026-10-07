"use client";

import { useEffect } from "react";
import { BUILD_ID, avisarVersaoNova } from "@/lib/client/versao";

const INTERVALO_MS = 5 * 60 * 1000;

/**
 * Detecta deploy novo enquanto a aba está aberta (compara o build do bundle com o
 * do servidor) e oferece recarregar antes que uma Server Action falhe.
 */
export function VersionWatcher() {
  useEffect(() => {
    if (!BUILD_ID || process.env.NODE_ENV !== "production") return;
    let avisado = false;

    async function checar() {
      if (avisado || document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/health?v=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { build?: string };
        if (data.build && data.build !== BUILD_ID) {
          avisado = true;
          avisarVersaoNova();
        }
      } catch {
        // offline / reiniciando — tenta de novo depois
      }
    }

    const timer = window.setInterval(checar, INTERVALO_MS);
    document.addEventListener("visibilitychange", checar);
    window.addEventListener("focus", checar);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checar);
      window.removeEventListener("focus", checar);
    };
  }, []);

  return null;
}
