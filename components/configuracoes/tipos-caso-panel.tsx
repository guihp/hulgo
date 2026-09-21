"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  atualizarTipoCaso,
  criarTipoCaso,
  desativarTipoCaso,
  reativarTipoCaso,
  type TipoCasoMatch,
} from "@/lib/actions/tipos-caso";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const cardShell =
  "rounded-2xl border border-[#e2e8f0] bg-white shadow-none";
const inputShell =
  "border-[#e2e8f0] bg-white text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12";
const btnPrimary =
  "rounded-full bg-[#0b2148] text-white hover:bg-[#163a7a]";
const btnOutline =
  "rounded-full border-[#e2e8f0] bg-white text-[#0b2148] hover:bg-[#F8FAFC]";

type Draft = {
  id: string | null;
  chave: string;
  label: string;
  aliases: string[];
  documentos: string[];
  ativo: boolean;
  ordem: number;
};

function toDraft(t: TipoCasoMatch): Draft {
  return {
    id: t.id,
    chave: t.chave,
    label: t.label,
    aliases: [...t.aliases],
    documentos: [...t.documentos],
    ativo: t.ativo,
    ordem: t.ordem,
  };
}

function emptyDraft(): Draft {
  return {
    id: null,
    chave: "",
    label: "",
    aliases: [],
    documentos: [],
    ativo: true,
    ordem: 100,
  };
}

export function TiposCasoPanel({ initialTipos }: { initialTipos: TipoCasoMatch[] }) {
  const [tipos, setTipos] = useState(initialTipos);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialTipos.find((t) => t.ativo)?.id ?? initialTipos[0]?.id ?? null
  );
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => {
    const first = initialTipos.find((t) => t.ativo) ?? initialTipos[0];
    return first ? toDraft(first) : emptyDraft();
  });
  const [aliasInput, setAliasInput] = useState("");
  const [docInput, setDocInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [showInactive, setShowInactive] = useState(false);

  const visible = useMemo(
    () => tipos.filter((t) => showInactive || t.ativo),
    [tipos, showInactive]
  );

  function selectTipo(t: TipoCasoMatch) {
    setCreating(false);
    setSelectedId(t.id);
    setDraft(toDraft(t));
    setAliasInput("");
    setDocInput("");
  }

  function startNovo() {
    setCreating(true);
    setSelectedId(null);
    setDraft(emptyDraft());
    setAliasInput("");
    setDocInput("");
  }

  function addAlias() {
    const v = aliasInput.trim();
    if (!v) return;
    if (draft.aliases.some((a) => a.toLowerCase() === v.toLowerCase())) {
      setAliasInput("");
      return;
    }
    setDraft((d) => ({ ...d, aliases: [...d.aliases, v] }));
    setAliasInput("");
  }

  function removeAlias(alias: string) {
    setDraft((d) => ({
      ...d,
      aliases: d.aliases.filter((a) => a !== alias),
    }));
  }

  function addDoc() {
    const v = docInput.trim();
    if (!v) return;
    setDraft((d) => ({ ...d, documentos: [...d.documentos, v] }));
    setDocInput("");
  }

  function removeDoc(idx: number) {
    setDraft((d) => ({
      ...d,
      documentos: d.documentos.filter((_, i) => i !== idx),
    }));
  }

  function moveDoc(idx: number, dir: -1 | 1) {
    setDraft((d) => {
      const next = [...d.documentos];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return d;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...d, documentos: next };
    });
  }

  function upsertLocal(row: TipoCasoMatch) {
    setTipos((prev) => {
      const i = prev.findIndex((t) => t.id === row.id);
      if (i < 0) return [...prev, row].sort((a, b) => a.ordem - b.ordem);
      const copy = [...prev];
      copy[i] = row;
      return copy.sort((a, b) => a.ordem - b.ordem);
    });
  }

  function handleSalvar() {
    startTransition(async () => {
      try {
        if (creating || !draft.id) {
          const row = await criarTipoCaso({
            chave: draft.chave || undefined,
            label: draft.label,
            aliases: draft.aliases,
            documentos: draft.documentos,
          });
          const match: TipoCasoMatch = {
            id: row.id,
            chave: row.chave,
            label: row.label,
            aliases: row.aliases ?? [],
            documentos: row.documentos ?? [],
            ativo: row.ativo,
            ordem: row.ordem,
          };
          upsertLocal(match);
          setCreating(false);
          setSelectedId(match.id);
          setDraft(toDraft(match));
          toast.success("Tipo criado");
        } else {
          const row = await atualizarTipoCaso({
            id: draft.id,
            label: draft.label,
            aliases: draft.aliases,
            documentos: draft.documentos,
          });
          const match: TipoCasoMatch = {
            id: row.id,
            chave: row.chave,
            label: row.label,
            aliases: row.aliases ?? [],
            documentos: row.documentos ?? [],
            ativo: row.ativo,
            ordem: row.ordem,
          };
          upsertLocal(match);
          setDraft(toDraft(match));
          toast.success("Tipo salvo");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao salvar");
      }
    });
  }

  function handleDesativar() {
    if (!draft.id) return;
    startTransition(async () => {
      try {
        const row = await desativarTipoCaso(draft.id!);
        const match: TipoCasoMatch = {
          id: row.id,
          chave: row.chave,
          label: row.label,
          aliases: row.aliases ?? [],
          documentos: row.documentos ?? [],
          ativo: row.ativo,
          ordem: row.ordem,
        };
        upsertLocal(match);
        setDraft(toDraft(match));
        toast.success("Tipo desativado");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao desativar");
      }
    });
  }

  function handleReativar() {
    if (!draft.id) return;
    startTransition(async () => {
      try {
        const row = await reativarTipoCaso(draft.id!);
        const match: TipoCasoMatch = {
          id: row.id,
          chave: row.chave,
          label: row.label,
          aliases: row.aliases ?? [],
          documentos: row.documentos ?? [],
          ativo: row.ativo,
          ordem: row.ordem,
        };
        upsertLocal(match);
        setDraft(toDraft(match));
        toast.success("Tipo reativado");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao reativar");
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.85fr)_minmax(0,1.35fr)]">
      <section className={cn(cardShell, "p-4 sm:p-5")}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#0b2148]">Tipos de caso</h2>
            <p className="mt-0.5 text-sm text-[#64748b]">
              O agente pede os documentos na ordem definida em cada tipo.
            </p>
          </div>
          <Button size="sm" className={cn(btnPrimary, "shrink-0 gap-1.5")} onClick={startNovo}>
            <Plus className="size-4" />
            Novo tipo
          </Button>
        </div>

        <button
          type="button"
          className="mt-3 text-xs font-medium text-[#64748b] hover:text-[#0b2148]"
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? "Ocultar inativos" : "Mostrar inativos"}
        </button>

        <ul className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto">
          {visible.length === 0 ? (
            <li className="rounded-xl border border-dashed border-[#e2e8f0] px-3 py-6 text-center text-sm text-[#64748b]">
              Nenhum tipo
            </li>
          ) : (
            visible.map((t) => {
              const selected = selectedId === t.id && !creating;
              return (
                <li key={t.id ?? t.chave}>
                  <button
                    type="button"
                    onClick={() => selectTipo(t)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "border-[#0b2148]/35 bg-[#0b2148]/5 shadow-sm"
                        : "border-[#e2e8f0] bg-white hover:border-[#0b2148]/25 hover:bg-[#F8FAFC]"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#0f172a]">
                        {t.label}
                        {!t.ativo ? (
                          <span className="ml-1 text-xs font-normal text-[#94a3b8]">
                            (inativo)
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-[#94a3b8]">
                        {t.chave}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full border border-[#e2e8f0] bg-[#F8FAFC] px-2 py-0.5 text-[11px] font-semibold text-[#64748b]">
                      {t.documentos.length === 1
                        ? "1 doc"
                        : `${t.documentos.length} docs`}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </section>

      <section className={cn(cardShell, "p-4 sm:p-5")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-base font-bold text-[#0b2148]">
            {creating || !draft.id
              ? "Novo tipo"
              : draft.label || "Sem nome"}
          </h2>
          {draft.chave ? (
            <span className="rounded-full border border-[#e2e8f0] bg-[#F8FAFC] px-2.5 py-0.5 text-[11px] font-medium text-[#64748b]">
              chave {draft.chave}
            </span>
          ) : null}
        </div>

        <div className="mt-5 space-y-5">
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
              Nome exibido
            </label>
            <Input
              className={inputShell}
              value={draft.label}
              onChange={(e) =>
                setDraft((d) => ({ ...d, label: e.target.value }))
              }
              placeholder="Ex.: Auxílio por incapacidade temporária"
            />
          </div>

          {(creating || !draft.id) && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                Chave
              </label>
              <Input
                className={inputShell}
                value={draft.chave}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, chave: e.target.value }))
                }
                placeholder="ex.: incapacidade"
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
              Apelidos reconhecidos
            </label>
            <div className="flex flex-wrap gap-1.5">
              {draft.aliases.map((a) => (
                <span
                  key={a}
                  className="inline-flex items-center gap-1 rounded-full border border-[#e2e8f0] bg-[#F8FAFC] px-2.5 py-1 text-xs font-medium text-[#0b2148]"
                >
                  {a}
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-[#94a3b8] hover:bg-[#e2e8f0] hover:text-[#0b2148]"
                    onClick={() => removeAlias(a)}
                    aria-label={`Remover ${a}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                className={inputShell}
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                placeholder="Ex.: auxílio-doença"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAlias();
                  }
                }}
              />
              <Button type="button" variant="outline" className={btnOutline} onClick={addAlias}>
                Adicionar
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                Documentos solicitados
              </label>
              <span className="text-[11px] text-[#94a3b8]">
                a ordem é a ordem do pedido
              </span>
            </div>
            <ul className="space-y-1.5">
              {draft.documentos.length === 0 ? (
                <li className="rounded-xl border border-dashed border-[#e2e8f0] px-3 py-4 text-sm text-[#64748b]">
                  Nenhum documento ainda
                </li>
              ) : (
                draft.documentos.map((doc, idx) => (
                  <li
                    key={`${doc}-${idx}`}
                    className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-2 py-1.5"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[#0b2148] text-xs font-bold text-white">
                      {idx + 1}
                    </span>
                    <Input
                      className={cn(inputShell, "h-8 border-transparent bg-transparent shadow-none focus-visible:border-[#0b2148]")}
                      value={doc}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraft((d) => {
                          const next = [...d.documentos];
                          next[idx] = v;
                          return { ...d, documentos: next };
                        });
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-[#64748b]"
                      disabled={idx === 0}
                      onClick={() => moveDoc(idx, -1)}
                      aria-label="Subir"
                    >
                      <ChevronUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-[#64748b]"
                      disabled={idx === draft.documentos.length - 1}
                      onClick={() => moveDoc(idx, 1)}
                      aria-label="Descer"
                    >
                      <ChevronDown className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-[#94a3b8] hover:text-rose-600"
                      onClick={() => removeDoc(idx)}
                      aria-label="Remover"
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))
              )}
            </ul>
            <div className="flex gap-2">
              <Input
                className={inputShell}
                value={docInput}
                onChange={(e) => setDocInput(e.target.value)}
                placeholder="Ex.: CNIS"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDoc();
                  }
                }}
              />
              <Button type="button" variant="outline" className={btnOutline} onClick={addDoc}>
                Adicionar
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e2e8f0] pt-4">
            <div className="flex flex-wrap gap-2">
              <Button
                className={cn(btnPrimary, "gap-1.5")}
                disabled={pending || !draft.label.trim()}
                onClick={handleSalvar}
              >
                <Save className="size-4" />
                {creating || !draft.id ? "Criar tipo" : "Salvar tipo"}
              </Button>
              {!creating && draft.id && draft.ativo ? (
                <Button
                  variant="outline"
                  disabled={pending}
                  className="rounded-full border-rose-200 text-rose-700 hover:bg-rose-50"
                  onClick={handleDesativar}
                >
                  Desativar tipo
                </Button>
              ) : null}
              {!creating && draft.id && !draft.ativo ? (
                <Button
                  variant="outline"
                  disabled={pending}
                  className={btnOutline}
                  onClick={handleReativar}
                >
                  Reativar
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-[#94a3b8]">
              {draft.documentos.length === 1
                ? "1 documento nesta lista"
                : `${draft.documentos.length} documentos nesta lista`}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
