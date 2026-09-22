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

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Android (qualquer browser) — candidato a banner de instalação. */
export function isAndroidDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

/**
 * Browser que costuma emitir beforeinstallprompt (Chrome/Edge/Samsung).
 * WebViews (Instagram, WhatsApp) geralmente não.
 */
export function supportsNativeInstallPrompt(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isIosDevice()) return false;
  const ua = navigator.userAgent;
  if (/; wv\)/i.test(ua) || /FBAN|FBAV|Instagram|Line\//i.test(ua)) {
    return false;
  }
  return /Chrome|Chromium|EdgA?|SamsungBrowser/i.test(ua);
}
