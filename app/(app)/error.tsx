"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buscarDetalheErro,
  digestDoErro,
  mensagemErro,
} from "@/lib/client/erros";
import { isVersaoDesatualizada } from "@/lib/client/versao";

/** Falha ao montar uma página: mostra o motivo traduzido e o código para o suporte. */
export default function ErroPagina({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const digest = digestDoErro(error);
  const [detalhe, setDetalhe] = useState<string | null>(null);

  useEffect(() => {
    if (!digest) return;
    let cancelado = false;
    void buscarDetalheErro(digest).then((d) => {
      if (!cancelado) setDetalhe(d);
    });
    return () => {
      cancelado = true;
    };
  }, [digest]);

  const versaoNova = isVersaoDesatualizada(error);
  const texto =
    detalhe ??
    (digest
      ? "Não foi possível carregar esta página."
      : mensagemErro(error, "Não foi possível carregar esta página"));

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="size-6" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-[#0b2148]">Algo deu errado</h1>
        <p className="text-sm text-[#64748B]">{texto}</p>
        {digest ? (
          <p className="text-xs text-[#94a3b8]">
            Código do erro: <span className="font-mono">{digest}</span>
          </p>
        ) : null}
      </div>
      <Button
        onClick={() => (versaoNova ? window.location.reload() : unstable_retry())}
        className="gap-2"
      >
        <RotateCcw className="size-4" />
        {versaoNova ? "Recarregar" : "Tentar de novo"}
      </Button>
    </div>
  );
}
