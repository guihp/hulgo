"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";
import { toast } from "sonner";

/** Id gerado no build (next.config `env`) — muda a cada deploy. */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

const TOAST_ID = "versao-nova";

/**
 * Aba aberta antes de um deploy chama uma Server Action com id do build antigo
 * ("Server Action ... was not found on the server"). Só recarregar resolve.
 */
export function isVersaoDesatualizada(e: unknown): boolean {
  if (unstable_isUnrecognizedActionError(e)) return true;
  return (
    e instanceof Error &&
    /Server Action .* was not found on the server/i.test(e.message)
  );
}

export function avisarVersaoNova() {
  toast.info("O sistema foi atualizado", {
    id: TOAST_ID,
    description: "Recarregue a página para continuar — nada do que estava pendente se perde.",
    duration: Infinity,
    action: {
      label: "Recarregar",
      onClick: () => window.location.reload(),
    },
  });
}

/** `toast.error` para catch de Server Action, trocando o erro de versão pelo aviso de recarregar. */
export function toastErroAcao(e: unknown, fallback: string) {
  if (isVersaoDesatualizada(e)) {
    avisarVersaoNova();
    return;
  }
  toast.error(e instanceof Error ? e.message : fallback);
}
