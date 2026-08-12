"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Save,
  Trash2,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Tipos de caso e documentos da IA</CardTitle>
          <CardDescription>
            Defina benefícios/tipos e a lista de documentos que a IA deve pedir.
            O Kanban e a API de integração usam esta lista.
          </CardDescription>
        </div>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={startNovo}>
          <Plus className="h-4 w-4" />
          Novo tipo
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <div className="space-y-2">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowInactive((v) => !v)}
            >
              {showInactive ? "Ocultar inativos" : "Mostrar inativos"}
            </button>
            <ul className="max-h-[28rem] space-y-1 overflow-y-auto rounded-lg border p-1">
              {visible.length === 0 ? (
                <li className="px-2 py-3 text-sm text-muted-foreground">
                  Nenhum tipo
                </li>
              ) : (
                visible.map((t) => (
                  <li key={t.id ?? t.chave}>
                    <button
                      type="button"
                      onClick={() => selectTipo(t)}
                      className={cn(
                        "flex w-full flex-col items-start rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                        selectedId === t.id && !creating
                          ? "bg-muted"
                          : "hover:bg-muted/60"
                      )}
                    >
                      <span className="font-medium leading-tight">
                        {t.label}
                        {!t.ativo ? (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            (inativo)
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t.documentos.length} doc
                        {t.documentos.length === 1 ? "" : "s"}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="space-y-4 rounded-lg border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Nome
                </label>
                <Input
                  value={draft.label}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, label: e.target.value }))
                  }
                  placeholder="Ex.: Auxílio por incapacidade temporária"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Chave {creating || !draft.id ? "" : "(somente leitura)"}
                </label>
                <Input
                  value={draft.chave}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, chave: e.target.value }))
                  }
                  placeholder="ex.: incapacidade"
                  disabled={!creating && !!draft.id}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Aliases (match no benefício identificado)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {draft.aliases.map((a) => (
                  <Badge key={a} variant="secondary" className="gap-1 pr-1">
                    {a}
                    <button
                      type="button"
                      className="rounded-sm p-0.5 hover:bg-muted"
                      onClick={() => removeAlias(a)}
                      aria-label={`Remover ${a}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
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
                <Button type="button" variant="outline" onClick={addAlias}>
                  Add
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Documentos (ordem = ordem da IA)
              </label>
              <ul className="space-y-1">
                {draft.documentos.length === 0 ? (
                  <li className="text-sm text-muted-foreground">
                    Nenhum documento ainda
                  </li>
                ) : (
                  draft.documentos.map((doc, idx) => (
                    <li
                      key={`${doc}-${idx}`}
                      className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">{doc}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={idx === 0}
                        onClick={() => moveDoc(idx, -1)}
                        aria-label="Subir"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={idx === draft.documentos.length - 1}
                        onClick={() => moveDoc(idx, 1)}
                        aria-label="Descer"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => removeDoc(idx)}
                        aria-label="Remover"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))
                )}
              </ul>
              <div className="flex gap-2">
                <Input
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
                <Button type="button" variant="outline" onClick={addDoc}>
                  Add
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button
                className="gap-1.5"
                disabled={pending || !draft.label.trim()}
                onClick={handleSalvar}
              >
                <Save className="h-4 w-4" />
                {creating || !draft.id ? "Criar" : "Salvar"}
              </Button>
              {!creating && draft.id && draft.ativo ? (
                <Button
                  variant="destructive"
                  disabled={pending}
                  onClick={handleDesativar}
                >
                  Desativar
                </Button>
              ) : null}
              {!creating && draft.id && !draft.ativo ? (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={handleReativar}
                >
                  Reativar
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
