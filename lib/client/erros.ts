"use client";

import { toast } from "sonner";
import { isErroGenericoProducao, mensagemParaUsuario } from "@/lib/erros";
import { avisarVersaoNova, isVersaoDesatualizada } from "@/lib/client/versao";

/** Código que o Next anexa ao erro de servidor (mesmo valor gravado em app_erros_log). */
export function digestDoErro(e: unknown): string | null {
  if (typeof e === "object" && e !== null && "digest" in e) {
    const d = (e as { digest: unknown }).digest;
    if (typeof d === "string" && d && !d.startsWith("NEXT_")) return d;
  }
  return null;
}

function textoOriginal(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "";
}

/**
 * Texto amigável e síncrono para mostrar na tela (setError, toast).
 * Erro genérico de produção vira `fallback` + código para o suporte.
 */
export function mensagemErro(e: unknown, fallback: string): string {
  if (isVersaoDesatualizada(e)) {
    return "O sistema foi atualizado. Recarregue a página e tente de novo.";
  }
  const original = textoOriginal(e);
  const digest = digestDoErro(e);
  if (!original || isErroGenericoProducao(original)) {
    return digest ? `${fallback}. Erro no servidor (código ${digest}).` : fallback;
  }
  return mensagemParaUsuario(original) ?? fallback;
}

/**
 * Busca em /api/erros/{digest} a mensagem traduzida que o servidor gravou.
 * O log é gravado logo após a resposta; tenta algumas vezes.
 */
export async function buscarDetalheErro(digest: string): Promise<string | null> {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    try {
      const res = await fetch(`/api/erros/${encodeURIComponent(digest)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const body = (await res.json()) as {
          encontrado?: boolean;
          mensagem?: string | null;
        };
        if (body.encontrado) return body.mensagem ?? null;
      }
    } catch {
      // segue tentando
    }
    await new Promise((r) => setTimeout(r, 600 * (tentativa + 1)));
  }
  return null;
}

/**
 * `toast.error` para catch de Server Action: traduz o erro, troca o erro de
 * versão pelo aviso de recarregar e, quando só veio o código, busca o motivo.
 */
export function toastErroAcao(e: unknown, fallback: string) {
  if (isVersaoDesatualizada(e)) {
    avisarVersaoNova();
    return;
  }
  const texto = mensagemErro(e, fallback);
  const original = textoOriginal(e);
  const digest =
    !original || isErroGenericoProducao(original) ? digestDoErro(e) : null;
  if (!digest) {
    toast.error(texto);
    return;
  }
  const id = toast.error(fallback, {
    description: "Verificando o motivo…",
    duration: 15000,
  });
  void buscarDetalheErro(digest).then((detalhe) => {
    toast.error(detalhe ?? `${fallback}. Erro inesperado no servidor.`, {
      id,
      description: `Código ${digest}${detalhe ? "" : " — envie este código ao suporte."}`,
      duration: 15000,
    });
  });
}
