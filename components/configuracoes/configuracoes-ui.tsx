"use client";

import { useState } from "react";
import { WhatsAppQrPanel } from "@/components/configuracoes/whatsapp-qr-panel";
import { TiposCasoPanel } from "@/components/configuracoes/tipos-caso-panel";
import { AgenteIaPanel } from "@/components/configuracoes/agente-ia-panel";
import { TestarAgentePanel } from "@/components/configuracoes/testar-agente-panel";
import { EscritorioPanel } from "@/components/configuracoes/escritorio-panel";
import { ParceirosPanel } from "@/components/configuracoes/parceiros-panel";
import { AppCelularPanel } from "@/components/configuracoes/app-celular-panel";
import type { AppConfigMap } from "@/lib/config/app-config";
import type { TipoCasoMatch } from "@/lib/actions/tipos-caso";
import type { AgenteConfig, EquipeMember } from "@/lib/actions/configuracoes";
import type { Parceiro } from "@/lib/actions/parceiros";
import { cn } from "@/lib/utils";

const TABS = [
  {
    value: "whatsapp",
    label: "Conexão WhatsApp",
    subtitle: "Instância EvoGo, status e pareamento do número.",
  },
  {
    value: "tipos",
    label: "Tipos de documentos",
    subtitle: "Benefícios e a lista de documentos que o agente pede.",
  },
  {
    value: "agente",
    label: "Agente de IA",
    subtitle: "Prompt, persona e regras de comportamento do agente.",
  },
  {
    value: "testar",
    label: "Testar agente",
    subtitle: "Converse com o agente antes de publicar as mudanças.",
  },
  {
    value: "escritorio",
    label: "Escritório",
    subtitle: "Dados do escritório e equipe com acesso ao painel.",
  },
  {
    value: "parceiros",
    label: "Parceiros",
    subtitle: "Cadastro de parceiros com nome, cidade e telefone.",
  },
  {
    value: "app",
    label: "App no celular",
    subtitle: "Como instalar o PWA no Android e no iPhone e ativar o push.",
  },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export function ConfiguracoesUi({
  config,
  tipos,
  equipe,
  agente,
  parceiros,
}: {
  config: AppConfigMap;
  tipos: TipoCasoMatch[];
  equipe: EquipeMember[];
  agente: AgenteConfig | null;
  parceiros: Parceiro[];
}) {
  const [tab, setTab] = useState<TabValue>("whatsapp");
  const [mounted, setMounted] = useState<Partial<Record<TabValue, boolean>>>({
    whatsapp: true,
  });
  const active = TABS.find((t) => t.value === tab) ?? TABS[0];

  function goTab(next: TabValue) {
    setMounted((prev) => (prev[next] ? prev : { ...prev, [next]: true }));
    setTab(next);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#0b2148]">
          Configurações
        </h1>
        <p className="mt-1 text-sm text-[#64748b]">{active.subtitle}</p>
      </div>

      <div
        role="tablist"
        aria-label="Seções de configuração"
        className="flex flex-wrap gap-1.5"
      >
        {TABS.map((t) => {
          const selected = tab === t.value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => goTab(t.value)}
              className={cn(
                "inline-flex h-auto items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                selected
                  ? "border-[#0b2148] bg-[#0b2148] text-white shadow-sm"
                  : "border-transparent bg-transparent text-[#64748b] hover:text-[#0b2148]"
              )}
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  selected ? "bg-white/90" : "bg-[#94a3b8]"
                )}
                aria-hidden
              />
              {t.label}
            </button>
          );
        })}
      </div>

      <div>
        {mounted.whatsapp ? (
          <div
            role="tabpanel"
            hidden={tab !== "whatsapp"}
            className={tab === "whatsapp" ? undefined : "hidden"}
          >
            <WhatsAppQrPanel />
          </div>
        ) : null}
        {mounted.tipos ? (
          <div
            role="tabpanel"
            hidden={tab !== "tipos"}
            className={tab === "tipos" ? undefined : "hidden"}
          >
            <TiposCasoPanel initialTipos={tipos} />
          </div>
        ) : null}
        {mounted.agente ? (
          <div
            role="tabpanel"
            hidden={tab !== "agente"}
            className={tab === "agente" ? undefined : "hidden"}
          >
            <AgenteIaPanel
              escritorioNome={config.escritorio_nome}
              initial={agente}
              onGoTest={() => goTab("testar")}
            />
          </div>
        ) : null}
        {mounted.testar ? (
          <div
            role="tabpanel"
            hidden={tab !== "testar"}
            className={tab === "testar" ? undefined : "hidden"}
          >
            <TestarAgentePanel
              tipos={tipos}
              escritorioNome={config.escritorio_nome}
            />
          </div>
        ) : null}
        {mounted.escritorio ? (
          <div
            role="tabpanel"
            hidden={tab !== "escritorio"}
            className={tab === "escritorio" ? undefined : "hidden"}
          >
            <EscritorioPanel config={config} equipe={equipe} />
          </div>
        ) : null}
        {mounted.parceiros ? (
          <div
            role="tabpanel"
            hidden={tab !== "parceiros"}
            className={tab === "parceiros" ? undefined : "hidden"}
          >
            <ParceirosPanel initialParceiros={parceiros} />
          </div>
        ) : null}
        {mounted.app ? (
          <div
            role="tabpanel"
            hidden={tab !== "app"}
            className={tab === "app" ? undefined : "hidden"}
          >
            <AppCelularPanel />
          </div>
        ) : null}
      </div>
    </div>
  );
}
