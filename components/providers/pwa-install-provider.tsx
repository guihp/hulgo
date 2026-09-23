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
  isIosDevice,
  isStandaloneDisplay,
  type BeforeInstallPromptEvent,
} from "@/lib/client/pwa-install";

type PwaInstallContextValue = {
  isInstalled: boolean;
  /** Chrome/Edge liberou instalação nativa (beforeinstallprompt). */
  canNativeInstall: boolean;
  isIos: boolean;
  busy: boolean;
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
};

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [isInstalled, setIsInstalled] = useState(true);
  const [isIos, setIsIos] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setIsInstalled(isStandaloneDisplay());
    setIsIos(isIosDevice());

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);

    const mq = window.matchMedia("(display-mode: standalone)");
    const onMode = () => setIsInstalled(isStandaloneDisplay());
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
      if (outcome === "accepted") setIsInstalled(true);
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
      isIos,
      busy,
      install,
    }),
    [isInstalled, deferred, isIos, busy, install]
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
      isIos: false,
      busy: false,
      install: async () => "unavailable",
    };
  }
  return ctx;
}
