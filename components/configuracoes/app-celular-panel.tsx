"use client";

import { Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

const cardShell =
  "rounded-2xl border border-[#e2e8f0] bg-white shadow-none";

export function AppCelularPanel() {
  return (
    <div className="max-w-2xl space-y-4">
      <section className={cn(cardShell, "p-5 sm:p-6")}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-[#F8FAFC] text-[#0b2148]">
            <Smartphone className="size-4" aria-hidden />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#0b2148]">
              Instalar o app no celular
            </h2>
            <p className="mt-0.5 text-sm text-[#64748b]">
              O painel é um PWA: instale na tela inicial para abrir como app e
              receber avisos com o sistema fechado.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-[#0b2148]">
              Android (Chrome)
            </h3>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-[#475569]">
              <li>Abra o painel no Chrome.</li>
              <li>
                Toque no menu <span className="font-medium text-[#0b2148]">⋮</span>.
              </li>
              <li>
                Escolha{" "}
                <span className="font-medium text-[#0b2148]">
                  Instalar app
                </span>{" "}
                ou{" "}
                <span className="font-medium text-[#0b2148]">
                  Adicionar à tela inicial
                </span>
                .
              </li>
            </ol>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[#0b2148]">
              iPhone / iPad (Safari)
            </h3>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-[#475569]">
              <li>Abra o painel no Safari (não use Chrome no iOS).</li>
              <li>
                Toque em{" "}
                <span className="font-medium text-[#0b2148]">Compartilhar</span>{" "}
                (ícone da seta para cima).
              </li>
              <li>
                Escolha{" "}
                <span className="font-medium text-[#0b2148]">
                  Adicionar à Tela de Início
                </span>
                .
              </li>
            </ol>
            <p className="mt-2 text-sm text-[#64748b]">
              No iOS 16.4 ou superior, a instalação pelo Safari é necessária
              para as notificações push funcionarem.
            </p>
          </div>
        </div>

        <p className="mt-5 border-t border-[#e2e8f0] pt-4 text-sm text-[#64748b]">
          Depois de instalar, abra o app pela tela inicial e toque no sino →{" "}
          <span className="font-medium text-[#0b2148]">
            Ativar notificações do app
          </span>
          . Assim você recebe avisos mesmo com o painel fechado.
        </p>
      </section>
    </div>
  );
}
