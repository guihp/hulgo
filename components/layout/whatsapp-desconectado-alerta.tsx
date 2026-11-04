"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WifiOff } from "lucide-react";

const VERIFICAR_MS = 60_000;

/**
 * Faixa fixa no topo enquanto o WhatsApp do escritório estiver desconectado:
 * sem conexão não chegam mensagens no painel e a IA não responde ninguém.
 */
export function WhatsAppDesconectadoAlerta({ podeReconectar }: { podeReconectar: boolean }) {
  const [desconectado, setDesconectado] = useState(false);

  useEffect(() => {
    let ativo = true;
    async function verificar() {
      try {
        const res = await fetch("/api/whatsapp/status", { cache: "no-store" });
        const json = (await res.json()) as { ok?: boolean; conectado?: boolean | null };
        // null = não deu para perguntar; não acusa desconexão sem certeza.
        if (ativo && json.ok) setDesconectado(json.conectado === false);
      } catch {
        // rede instável: mantém o último estado
      }
    }
    void verificar();
    const timer = setInterval(verificar, VERIFICAR_MS);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void verificar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      ativo = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);

  if (!desconectado) return null;

  return (
    <div
      role="alert"
      className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-rose-600 px-4 py-2 text-center text-sm text-white"
    >
      <span className="flex items-center gap-2 font-semibold">
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
        O WhatsApp do escritório está desconectado.
      </span>
      <span className="text-rose-50">
        As mensagens não chegam no painel e a IA não responde até reconectar o celular.
      </span>
      {podeReconectar ? (
        <Link
          href="/configuracoes"
          className="rounded-full bg-white px-3 py-0.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
        >
          Reconectar agora
        </Link>
      ) : (
        <span className="text-xs font-semibold">Avise um advogado para reconectar.</span>
      )}
    </div>
  );
}
