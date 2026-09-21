"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  salvarDadosEscritorio,
  type EquipeMember,
} from "@/lib/actions/configuracoes";
import type { AppConfigMap } from "@/lib/config/app-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const cardShell =
  "rounded-2xl border border-[#e2e8f0] bg-white shadow-none";
const inputShell =
  "border-[#e2e8f0] bg-white text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12";
const btnPrimary =
  "rounded-full bg-[#0b2148] text-white hover:bg-[#163a7a]";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roleMeta(papel: string) {
  const p = papel.toLowerCase();
  if (p === "advogado") {
    return {
      badge: "Admin",
      badgeClass: "border-transparent bg-[#0b2148] text-white",
      subtitle: "Advogado responsável",
    };
  }
  if (p === "editor") {
    return {
      badge: "Editor",
      badgeClass: "border-[#0b2148]/30 bg-white text-[#0b2148]",
      subtitle: "Advogada",
    };
  }
  if (p === "estagiario" || p === "estagiário" || p === "leitura") {
    return {
      badge: "Leitura",
      badgeClass: "border-[#e2e8f0] bg-white text-[#64748b]",
      subtitle: "Estagiário",
    };
  }
  return {
    badge: papel.charAt(0).toUpperCase() + papel.slice(1),
    badgeClass: "border-[#e2e8f0] bg-[#F8FAFC] text-[#64748b]",
    subtitle: `Papel: ${papel}`,
  };
}

export function EscritorioPanel({
  config,
  equipe,
}: {
  config: AppConfigMap;
  equipe: EquipeMember[];
}) {
  const [nome, setNome] = useState(config.escritorio_nome || "");
  const [instancia, setInstancia] = useState(config.whatsapp_instancia || "");
  const [pending, startTransition] = useTransition();

  function handleSalvar() {
    startTransition(async () => {
      try {
        await salvarDadosEscritorio({
          escritorio_nome: nome,
          whatsapp_instancia: instancia,
        });
        toast.success("Dados do escritório salvos");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao salvar");
      }
    });
  }

  const membros = equipe.filter((m) => m.ativo !== false);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={cn(cardShell, "p-5 sm:p-6")}>
        <h2 className="text-base font-bold text-[#0b2148]">
          Dados do escritório
        </h2>
        <p className="mt-0.5 text-sm text-[#64748b]">
          Aparecem nas mensagens e nos relatórios.
        </p>

        <div className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
              Nome do escritório
            </label>
            <Input
              className={inputShell}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Boueres e Fonteles Advogados"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
              Instância WhatsApp
            </label>
            <Input
              className={inputShell}
              value={instancia}
              onChange={(e) => setInstancia(e.target.value)}
              placeholder="Ex.: testehulgo"
            />
          </div>
        </div>

        <div className="mt-6">
          <Button
            type="button"
            className={btnPrimary}
            disabled={pending || !nome.trim()}
            onClick={handleSalvar}
          >
            {pending ? "Salvando…" : "Salvar dados"}
          </Button>
        </div>
      </section>

      <section className={cn(cardShell, "p-5 sm:p-6")}>
        <h2 className="text-base font-bold text-[#0b2148]">
          Equipe com acesso
        </h2>
        <ul className="mt-4 space-y-3">
          {membros.length === 0 ? (
            <li className="rounded-xl border border-dashed border-[#e2e8f0] px-3 py-6 text-center text-sm text-[#64748b]">
              Nenhum usuário ativo em app_usuarios.
            </li>
          ) : (
            membros.map((m) => {
              const meta = roleMeta(m.papel);
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#0b2148]/10 text-xs font-bold text-[#0b2148]">
                    {initialsFromName(m.nome)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[#0f172a]">
                      {m.nome}
                    </span>
                    <span className="block truncate text-xs text-[#64748b]">
                      {meta.subtitle}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                      meta.badgeClass
                    )}
                  >
                    {meta.badge}
                  </span>
                </li>
              );
            })
          )}
        </ul>
        <p className="mt-4 text-xs text-[#94a3b8]">
          Convites são feitos no Supabase Auth + registro em{" "}
          <code className="rounded bg-[#F1F5F9] px-1">app_usuarios</code>.
        </p>
      </section>
    </div>
  );
}
