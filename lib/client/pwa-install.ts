/**
 * Chrome/Edge/Android: captura `beforeinstallprompt` para um botão
 * "Instalar app" que dispara o diálogo nativo (`prompt()`).
 * iOS Safari não dispara esse evento — só o fluxo manual.
 */

export type BeforeInstallPromptEvent = Event & {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return Boolean(nav.standalone);
}
