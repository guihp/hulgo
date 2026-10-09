"use client";

import { useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import {
  arquivarProcessoColuna,
  atualizarProcessoColuna,
  criarProcessoColuna,
  reativarProcessoColuna,
  reordenarProcessoColunas,
  type ProcessoColunaMatch,
} from "@/lib/actions/processo-colunas";
import {
  CORES_COLUNA_PROCESSO,
  FUNIL_PROCESSO_PADRAO,
  FUNIS_PROCESSO,
  type CorColunaProcesso,
  type FunilProcesso,
} from "@/lib/utils/processos";
import { COR_COLUNA_LABEL, corDot } from "@/components/processos/cores";
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

function sortColunas(list: ProcessoColunaMatch[]) {
  return [...list].sort(
    (a, b) => a.ordem - b.ordem || a.label.localeCompare(b.label)
  );
}

function CorPicker({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (cor: CorColunaProcesso) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cor da coluna">
      {CORES_COLUNA_PROCESSO.map((cor) => {
        const selected = value === cor;
        return (
          <button
            key={cor}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={COR_COLUNA_LABEL[cor]}
            title={COR_COLUNA_LABEL[cor]}
            disabled={disabled}
            onClick={() => onChange(cor)}
            className={cn(
              "size-5 rounded-full ring-offset-2 transition disabled:opacity-50",
              corDot(cor),
              selected ? "ring-2 ring-[#0b2148]" : "hover:ring-2 hover:ring-[#cbd5e1]"
            )}
          />
        );
      })}
    </div>
  );
}

const SEM_COLUNAS: ProcessoColunaMatch[] = [];

export function ProcessoColunasPanel({
  initialColunas,
}: {
  initialColunas: Record<FunilProcesso, ProcessoColunaMatch[]>;
}) {
  const [funil, setFunil] = useState<FunilProcesso>(FUNIL_PROCESSO_PADRAO);
  const [colunasPorFunil, setColunasPorFunil] = useState(initialColunas);
  const [showInactive, setShowInactive] = useState(false);
  const [novaLabel, setNovaLabel] = useState("");
  const [novaCor, setNovaCor] = useState<CorColunaProcesso>("blue");
  const [editLabels, setEditLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.values(initialColunas).flat().map((c) => [
        c.id ?? `${c.funil}:${c.chave}`,
        c.label,
      ])
    )
  );
  const [pending, startTransition] = useTransition();

  const colunas = colunasPorFunil[funil] ?? SEM_COLUNAS;
  const semIds = colunas.some((c) => !c.id);

  const visible = useMemo(() => {
    const list = showInactive ? colunas : colunas.filter((c) => c.ativo);
    return sortColunas(list);
  }, [colunas, showInactive]);

  function setColunas(
    updater: (list: ProcessoColunaMatch[]) => ProcessoColunaMatch[]
  ) {
    setColunasPorFunil((prev) => ({ ...prev, [funil]: updater(prev[funil] ?? []) }));
  }

  function syncLabels(list: ProcessoColunaMatch[]) {
    setEditLabels((prev) => ({
      ...prev,
      ...Object.fromEntries(list.map((c) => [c.id ?? `${c.funil}:${c.chave}`, c.label])),
    }));
  }

  function replaceColuna(updated: ProcessoColunaMatch) {
    setColunas((list) => list.map((c) => (c.id === updated.id ? updated : c)));
  }

  function criar() {
    const label = novaLabel.trim();
    if (!label) {
      toast.error("Informe o nome da coluna");
      return;
    }
    startTransition(async () => {
      try {
        const created = await criarProcessoColuna({ funil, label, cor: novaCor });
        setColunas((list) => sortColunas([...list, created]));
        syncLabels([created]);
        setNovaLabel("");
        toast.success(`Coluna "${created.label}" criada`);
      } catch (err) {
        toastErroAcao(err, "Erro ao criar");
      }
    });
  }

  function salvarLabel(col: ProcessoColunaMatch) {
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
        const updated = await atualizarProcessoColuna({ id: col.id!, label });
        replaceColuna(updated);
        toast.success("Nome atualizado");
      } catch (err) {
        toastErroAcao(err, "Erro ao salvar");
      }
    });
  }

  function mudarCor(col: ProcessoColunaMatch, cor: CorColunaProcesso) {
    if (!col.id || col.cor === cor) return;
    startTransition(async () => {
      try {
        const updated = await atualizarProcessoColuna({ id: col.id!, cor });
        replaceColuna(updated);
      } catch (err) {
        toastErroAcao(err, "Erro ao mudar cor");
      }
    });
  }

  function mover(col: ProcessoColunaMatch, dir: -1 | 1) {
    const ordered = visible.filter((c) => c.id);
    const idx = ordered.findIndex((c) => c.id === col.id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= ordered.length) return;
    const next = [...ordered];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    const inativas = sortColunas(colunas.filter((c) => !c.ativo && c.id));
    const ids = [...next, ...inativas].map((c) => c.id!);
    const alvo = funil;
    startTransition(async () => {
      try {
        const updated = await reordenarProcessoColunas(alvo, ids);
        setColunasPorFunil((prev) => ({ ...prev, [alvo]: updated }));
        syncLabels(updated);
        toast.success("Ordem atualizada");
      } catch (err) {
        toastErroAcao(err, "Erro ao reordenar");
      }
    });
  }

  function toggleAtivo(col: ProcessoColunaMatch) {
    if (!col.id) return;
    startTransition(async () => {
      try {
        const updated = col.ativo
          ? await arquivarProcessoColuna(col.id!)
          : await reativarProcessoColuna(col.id!);
        replaceColuna(updated);
        toast.success(updated.ativo ? "Coluna reativada" : "Coluna arquivada");
      } catch (err) {
        toastErroAcao(err, "Erro");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className={cn(cardShell, "p-5 space-y-4")}>
        <div>
          <h2 className="text-lg font-semibold text-[#0b2148]">
            Funis de processos
          </h2>
          <p className="mt-1 text-sm text-[#64748b]">
            Cada funil (Cível, Administrativo Previdenciário, Judicial
            Previdenciário e Concedidos) tem colunas próprias na página
            Processos. Arquivar uma coluna não apaga os processos — eles passam
            a aparecer na primeira coluna ativa até serem movidos.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Funil"
          className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl border border-[#e2e8f0] bg-[#F8FAFC] p-1"
        >
          {FUNIS_PROCESSO.map((f) => {
            const selected = f.value === funil;
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setFunil(f.value)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  selected
                    ? "bg-[#0b2148] text-white"
                    : "text-[#64748b] hover:text-[#0b2148]"
                )}
              >
                {f.label}
                <span className="ml-1.5 opacity-70">
                  {(colunasPorFunil[f.value] ?? []).filter((c) => c.ativo).length}
                </span>
              </button>
            );
          })}
        </div>

        {semIds ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            As colunas deste funil ainda não estão no banco (exibindo padrão).
            Aplique a migration de funis de processos para poder editá-las.
          </p>
        ) : null}

        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              className={inputShell}
              placeholder="Nova coluna (ex.: Aguardando perícia)"
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
          <div className="flex items-center gap-2 text-xs text-[#64748b]">
            Cor: <CorPicker value={novaCor} onChange={setNovaCor} disabled={pending} />
          </div>
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
          const key = col.id ?? `${col.funil}:${col.chave}`;
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
                  disabled={pending || showInactive || !col.id || index === 0}
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
                  disabled={
                    pending || showInactive || !col.id || index === visible.length - 1
                  }
                  onClick={() => mover(col, 1)}
                  aria-label="Descer"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn("size-3 shrink-0 rounded-full", corDot(col.cor))}
                    aria-hidden
                  />
                  <Input
                    className={inputShell}
                    value={editLabels[key] ?? col.label}
                    onChange={(e) =>
                      setEditLabels((m) => ({ ...m, [key]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") salvarLabel(col);
                    }}
                    disabled={!col.id}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <CorPicker
                    value={col.cor}
                    onChange={(cor) => mudarCor(col, cor)}
                    disabled={pending || !col.id}
                  />
                  <p className="truncate text-xs text-[#94a3b8]">
                    chave: <code>{col.chave}</code>
                    {!col.ativo ? " · arquivada" : ""}
                  </p>
                </div>
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
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
