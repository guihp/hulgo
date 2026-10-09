"use client";

import { useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import {
  atualizarKanbanColuna,
  arquivarKanbanColuna,
  criarKanbanColuna,
  reativarKanbanColuna,
  reordenarKanbanColunas,
  type KanbanColunaMatch,
} from "@/lib/actions/kanban-colunas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toastErroAcao } from "@/lib/client/erros";

const cardShell =
  "rounded-2xl border border-[#e2e8f0] bg-white shadow-none";
const inputShell =
  "border-[#e2e8f0] bg-white text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12";
const btnPrimary =
  "rounded-full bg-[#0b2148] text-white hover:bg-[#163a7a]";
const btnOutline =
  "rounded-full border-[#e2e8f0] bg-white text-[#0b2148] hover:bg-[#F8FAFC]";

export function KanbanColunasPanel({
  initialColunas,
}: {
  initialColunas: KanbanColunaMatch[];
}) {
  const [colunas, setColunas] = useState(initialColunas);
  const [showInactive, setShowInactive] = useState(false);
  const [novaLabel, setNovaLabel] = useState("");
  const [editLabels, setEditLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialColunas.map((c) => [c.id ?? c.chave, c.label]))
  );
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const list = showInactive ? colunas : colunas.filter((c) => c.ativo);
    return [...list].sort((a, b) => a.ordem - b.ordem || a.label.localeCompare(b.label));
  }, [colunas, showInactive]);

  function syncLabels(list: KanbanColunaMatch[]) {
    setEditLabels(
      Object.fromEntries(list.map((c) => [c.id ?? c.chave, c.label]))
    );
  }

  function criar() {
    const label = novaLabel.trim();
    if (!label) {
      toast.error("Informe o nome da coluna");
      return;
    }
    startTransition(async () => {
      try {
        const created = await criarKanbanColuna({ label });
        const next = [...colunas, created].sort(
          (a, b) => a.ordem - b.ordem || a.label.localeCompare(b.label)
        );
        setColunas(next);
        syncLabels(next);
        setNovaLabel("");
        toast.success(`Coluna "${created.label}" criada`);
      } catch (err) {
        toastErroAcao(err, "Erro ao criar");
      }
    });
  }

  function salvarLabel(col: KanbanColunaMatch) {
    if (!col.id) {
      toast.error("Coluna sem id — recarregue a página");
      return;
    }
    const label = (editLabels[col.id] ?? col.label).trim();
    if (!label) {
      toast.error("Nome obrigatório");
      return;
    }
    if (label === col.label) return;
    startTransition(async () => {
      try {
        const updated = await atualizarKanbanColuna({ id: col.id!, label });
        setColunas((list) =>
          list.map((c) => (c.id === updated.id ? updated : c))
        );
        toast.success("Nome atualizado");
      } catch (err) {
        toastErroAcao(err, "Erro ao salvar");
      }
    });
  }

  function mover(col: KanbanColunaMatch, dir: -1 | 1) {
    const ordered = visible.filter((c) => c.id);
    const idx = ordered.findIndex((c) => c.id === col.id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= ordered.length) return;
    const next = [...ordered];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    const ids = next.map((c) => c.id!);
    startTransition(async () => {
      try {
        const updated = await reordenarKanbanColunas(ids);
        setColunas(updated);
        syncLabels(updated);
        toast.success("Ordem atualizada");
      } catch (err) {
        toastErroAcao(err, "Erro ao reordenar");
      }
    });
  }

  function toggleAtivo(col: KanbanColunaMatch) {
    if (!col.id) return;
    if (col.is_system && col.ativo) {
      toast.error("Colunas do sistema não podem ser arquivadas");
      return;
    }
    startTransition(async () => {
      try {
        const updated = col.ativo
          ? await arquivarKanbanColuna(col.id!)
          : await reativarKanbanColuna(col.id!);
        setColunas((list) =>
          list.map((c) => (c.id === updated.id ? updated : c))
        );
        toast.success(updated.ativo ? "Coluna reativada" : "Coluna arquivada");
      } catch (err) {
        toastErroAcao(err, "Erro");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className={cn(cardShell, "p-5 space-y-3")}>
        <div>
          <h2 className="text-lg font-semibold text-[#0b2148]">
            Colunas do funil
          </h2>
          <p className="mt-1 text-sm text-[#64748b]">
            Colunas de sistema (IA/n8n) são imutáveis na chave — você pode
            renomear o rótulo e reordenar. Colunas personalizadas podem ser
            arquivadas.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            className={inputShell}
            placeholder="Nova coluna (ex.: Aguardando documentos)"
            value={novaLabel}
            onChange={(e) => setNovaLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") criar();
            }}
          />
          <Button
            className={btnPrimary}
            onClick={criar}
            disabled={pending || !novaLabel.trim()}
          >
            <Plus className="mr-1 h-4 w-4" />
            Adicionar
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm text-[#64748b]">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-[#e2e8f0]"
          />
          Mostrar arquivadas
        </label>
      </div>

      <ul className="space-y-2">
        {visible.map((col, index) => {
          const key = col.id ?? col.chave;
          return (
            <li
              key={key}
              className={cn(
                cardShell,
                "flex flex-col gap-3 p-4 sm:flex-row sm:items-center",
                !col.ativo && "opacity-60"
              )}
            >
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  disabled={pending || showInactive || index === 0}
                  onClick={() => mover(col, -1)}
                  aria-label="Subir"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  disabled={pending || showInactive || index === visible.length - 1}
                  onClick={() => mover(col, 1)}
                  aria-label="Descer"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <Input
                  className={inputShell}
                  value={editLabels[key] ?? col.label}
                  onChange={(e) =>
                    setEditLabels((m) => ({ ...m, [key]: e.target.value }))
                  }
                  disabled={!col.id}
                />
                <p className="truncate text-xs text-[#94a3b8]">
                  chave: <code>{col.chave}</code>
                  {col.is_system ? " · sistema" : " · personalizada"}
                  {!col.ativo ? " · arquivada" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className={btnOutline}
                  disabled={pending || !col.id}
                  onClick={() => salvarLabel(col)}
                >
                  <Save className="mr-1 h-3.5 w-3.5" />
                  Salvar
                </Button>
                {!col.is_system ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className={btnOutline}
                    disabled={pending || !col.id}
                    onClick={() => toggleAtivo(col)}
                  >
                    {col.ativo ? "Arquivar" : "Reativar"}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
