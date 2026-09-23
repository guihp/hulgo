"use client";

import { CheckCircle2, Download, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/components/providers/pwa-install-provider";
import { cn } from "@/lib/utils";

const cardShell =
  "rounded-2xl border border-[#e2e8f0] bg-white shadow-none";

export function AppCelularPanel() {
  const { canNativeInstall, isInstalled, busy, install, isIos } =
    usePwaInstall();

  async function onInstall() {
    const outcome = await install();
    if (outcome === "accepted") {
      toast.success("App instalado — abra pela tela inicial");
    } else if (outcome === "dismissed") {
      toast.message("Instalação cancelada");
    } else {
      toast.error(
        "Aguarde o Chrome liberar a instalação (ou use o menu ⋮ → Instalar app)."
      );
    }
  }

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

        {isInstalled ? (
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              App já instalado neste aparelho. Abra-o pela tela inicial para
              ativar as notificações.
            </p>
          </div>
        ) : canNativeInstall ? (
          <div className="mt-5 rounded-xl border border-[#0b2148]/15 bg-[#F8FAFC] p-4">
            <p className="text-sm text-[#475569]">
              O Chrome liberou a instalação — toque abaixo para confirmar.
            </p>
            <Button
              type="button"
              className="mt-3 w-full bg-[#0b2148] text-white hover:bg-[#0b2148]/90 sm:w-auto"
              disabled={busy}
              onClick={() => void onInstall()}
            >
              <Download className="size-4" />
              {busy ? "Abrindo instalação…" : "Instalar app agora"}
            </Button>
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
            {isIos
              ? "No iPhone use Safari → Compartilhar → Adicionar à Tela de Início (não há botão automático)."
              : "Quando o site estiver instalável, o botão aparece aqui e na faixa inferior. Abra no Chrome (não no WhatsApp) e aguarde alguns segundos após o login."}
          </div>
        )}

        <div className="mt-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-[#0b2148]">
              Android (Chrome)
            </h3>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-[#475569]">
              <li>Abra o painel no app Chrome.</li>
              <li>
                Quando aparecer, toque em{" "}
                <span className="font-medium text-[#0b2148]">
                  Instalar na tela inicial
                </span>{" "}
                (faixa inferior) ou use o menu{" "}
                <span className="font-medium text-[#0b2148]">⋮</span> → Instalar
                app.
              </li>
            </ol>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[#0b2148]">
              iPhone / iPad (Safari)
            </h3>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-[#475569]">
              <li>Abra o painel no Safari.</li>
              <li>
                Toque em{" "}
                <span className="font-medium text-[#0b2148]">Compartilhar</span>.
              </li>
              <li>
                Escolha{" "}
                <span className="font-medium text-[#0b2148]">
                  Adicionar à Tela de Início
                </span>
                .
              </li>
            </ol>
          </div>
        </div>

        <p className="mt-5 border-t border-[#e2e8f0] pt-4 text-sm text-[#64748b]">
          Depois de instalar, abra o app pela tela inicial e toque no sino →{" "}
          <span className="font-medium text-[#0b2148]">
            Ativar notificações do app
          </span>
          .
        </p>
      </section>
    </div>
  );
}
