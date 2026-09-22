"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  isAndroidDevice,
  isIosDevice,
  isStandaloneDisplay,
  supportsNativeInstallPrompt,
  type BeforeInstallPromptEvent,
} from "@/lib/client/pwa-install";

type PwaInstallContextValue = {
  /** Já rodando como PWA instalado. */
  isInstalled: boolean;
  /** Chrome disparou beforeinstallprompt — install() abre o diálogo nativo. */
  canNativeInstall: boolean;
  /** Mostrar CTA no front (Android / desktop Chromium, ainda não instalado). */
  shouldOfferInstall: boolean;
  /** iPhone/iPad — só fluxo manual Safari. */
  isIos: boolean;
  busy: boolean;
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
};

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [offer, setOffer] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const installed = isStandaloneDisplay();
    setIsInstalled(installed);
    setIsIos(isIosDevice());
    // Oferecer CTA no Android (e Chromium desktop) quando ainda não é PWA.
    setOffer(
      !installed &&
        (isAndroidDevice() || supportsNativeInstallPrompt()) &&
        !isIosDevice()
    );

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsInstalled(true);
      setOffer(false);
    };

    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);

    const mq = window.matchMedia("(display-mode: standalone)");
    const onMode = () => {
      const now = isStandaloneDisplay();
      setIsInstalled(now);
      if (now) setOffer(false);
    };
    mq.addEventListener?.("change", onMode);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
      mq.removeEventListener?.("change", onMode);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return "unavailable" as const;
    setBusy(true);
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      setDeferred(null);
      if (outcome === "accepted") {
        setIsInstalled(true);
        setOffer(false);
      }
      return outcome;
    } catch {
      return "unavailable" as const;
    } finally {
      setBusy(false);
    }
  }, [deferred]);

  const value = useMemo(
    () => ({
      isInstalled,
      canNativeInstall: Boolean(deferred) && !isInstalled,
      shouldOfferInstall: offer && !isInstalled,
      isIos,
      busy,
      install,
    }),
    [isInstalled, deferred, offer, isIos, busy, install]
  );

  return (
    <PwaInstallContext.Provider value={value}>
      {children}
    </PwaInstallContext.Provider>
  );
}

export function usePwaInstall(): PwaInstallContextValue {
  const ctx = useContext(PwaInstallContext);
  if (!ctx) {
    return {
      isInstalled: false,
      canNativeInstall: false,
      shouldOfferInstall: false,
      isIos: false,
      busy: false,
      install: async () => "unavailable",
    };
  }
  return ctx;
}
