"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  atualizarParceiro,
  criarParceiro,
  excluirParceiro,
  type Parceiro,
} from "@/lib/actions/parceiros";
import {
  formatPhone,
  maskPhoneBrInput,
  normalizePhoneBrStorage,
} from "@/lib/utils/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const cardShell = "rounded-2xl border border-[#e2e8f0] bg-white shadow-none";
const inputShell =
  "border-[#e2e8f0] bg-white text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12";
const btnPrimary =
  "rounded-full bg-[#0b2148] text-white hover:bg-[#163a7a]";
const btnOutline =
  "rounded-full border-[#e2e8f0] bg-white text-[#0b2148] hover:bg-[#F8FAFC]";
const btnDanger =
  "rounded-full border-red-200 bg-white text-red-700 hover:bg-red-50";

type Draft = {
  id: string | null;
  nome: string;
  cidade: string;
  telefoneMasked: string;
};

function emptyDraft(): Draft {
  return { id: null, nome: "", cidade: "", telefoneMasked: "" };
}

function toDraft(p: Parceiro): Draft {
  return {
    id: p.id,
    nome: p.nome,
    cidade: p.cidade ?? "",
    telefoneMasked: maskPhoneBrInput(p.telefone),
  };
}

export function ParceirosPanel({
  initialParceiros,
}: {
  initialParceiros: Parceiro[];
}) {
  const [parceiros, setParceiros] = useState(initialParceiros);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, startTransition] = useTransition();

  function startNovo() {
    setDraft(emptyDraft());
  }

  function startEdit(p: Parceiro) {
    setDraft(toDraft(p));
  }

  function cancelEdit() {
    setDraft(null);
  }

  function upsertLocal(row: Parceiro) {
    setParceiros((prev) => {
      const i = prev.findIndex((p) => p.id === row.id);
      const next =
        i < 0
          ? [...prev, row]
          : prev.map((p, idx) => (idx === i ? row : p));
      return next.sort((a, b) =>
        a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
      );
    });
  }

  function handleSalvar() {
    if (!draft) return;
    startTransition(async () => {
      try {
        if (!draft.id) {
          const row = await criarParceiro({
            nome: draft.nome,
            cidade: draft.cidade,
            telefone: draft.telefoneMasked,
          });
          upsertLocal(row);
          setDraft(null);
          toast.success("Parceiro criado");
        } else {
          const row = await atualizarParceiro({
            id: draft.id,
            nome: draft.nome,
            cidade: draft.cidade,
            telefone: draft.telefoneMasked,
          });
          upsertLocal(row);
          setDraft(null);
          toast.success("Parceiro salvo");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao salvar");
      }
    });
  }

  function handleExcluir(p: Parceiro) {
    if (
      !window.confirm(
        `Excluir o parceiro "${p.nome}"? Esta ação não pode ser desfeita.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await excluirParceiro(p.id);
        setParceiros((prev) => prev.filter((x) => x.id !== p.id));
        if (draft?.id === p.id) setDraft(null);
        toast.success("Parceiro excluído");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao excluir");
      }
    });
  }

  const editing = draft !== null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
      <section className={cn(cardShell, "p-4 sm:p-5")}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#0b2148]">Parceiros</h2>
            <p className="mt-0.5 text-sm text-[#64748b]">
              Cadastro de parceiros com nome, cidade e telefone WhatsApp.
            </p>
          </div>
          <Button
            size="sm"
            className={cn(btnPrimary, "shrink-0 gap-1.5")}
            onClick={startNovo}
            disabled={pending}
          >
            <Plus className="size-4" />
            Novo
          </Button>
        </div>

        <ul className="mt-4 max-h-[36rem] space-y-2 overflow-y-auto">
          {parceiros.length === 0 ? (
            <li className="rounded-xl border border-dashed border-[#e2e8f0] px-3 py-8 text-center text-sm text-[#64748b]">
              Nenhum parceiro cadastrado
            </li>
          ) : (
            parceiros.map((p) => {
              const selected = draft?.id === p.id;
              return (
                <li key={p.id}>
                  <div
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                      selected
                        ? "border-[#0b2148]/35 bg-[#0b2148]/5 shadow-sm"
                        : "border-[#e2e8f0] bg-white hover:border-[#0b2148]/25 hover:bg-[#F8FAFC]"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#0f172a]">
                        {p.nome}
                      </p>
                      <p className="truncate text-xs text-[#94a3b8]">
                        {[p.cidade || null, formatPhone(p.telefone)]
                          .filter(Boolean)
                          .join(" · ") || normalizePhoneBrStorage(p.telefone)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8 text-[#64748b] hover:text-[#0b2148]"
                        onClick={() => startEdit(p)}
                        disabled={pending}
                        aria-label={`Editar ${p.nome}`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8 text-[#64748b] hover:text-red-700"
                        onClick={() => handleExcluir(p)}
                        disabled={pending}
                        aria-label={`Excluir ${p.nome}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </section>

      <section className={cn(cardShell, "p-4 sm:p-5")}>
        {!editing ? (
          <div className="flex h-full min-h-[16rem] flex-col items-center justify-center px-4 text-center">
            <p className="text-sm font-medium text-[#0b2148]">
              Selecione um parceiro
            </p>
            <p className="mt-1 text-sm text-[#64748b]">
              Ou clique em Novo para cadastrar.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-bold text-[#0b2148]">
                {draft.id ? "Editar parceiro" : "Novo parceiro"}
              </h2>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 text-[#64748b]"
                onClick={cancelEdit}
                disabled={pending}
                aria-label="Cancelar"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                  Nome do parceiro
                </label>
                <Input
                  className={inputShell}
                  value={draft.nome}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, nome: e.target.value } : d))
                  }
                  placeholder="Ex.: João Silva"
                  disabled={pending}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                  Cidade
                </label>
                <Input
                  className={inputShell}
                  value={draft.cidade}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, cidade: e.target.value } : d))
                  }
                  placeholder="Ex.: São Luís"
                  disabled={pending}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                  Telefone
                </label>
                <Input
                  className={inputShell}
                  value={draft.telefoneMasked}
                  onChange={(e) =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            telefoneMasked: maskPhoneBrInput(e.target.value),
                          }
                        : d
                    )
                  }
                  placeholder="xx 9 xxxx-xxxx"
                  inputMode="tel"
                  disabled={pending}
                />
                <p className="text-[11px] text-[#94a3b8]">
                  O 9 após o DDD é fixo. Salvo: 55 + DDD + 9 + 8 dígitos
                  {draft.telefoneMasked
                    ? ` → ${normalizePhoneBrStorage(draft.telefoneMasked) || "—"}`
                    : null}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                className={cn(btnPrimary, "gap-1.5")}
                onClick={handleSalvar}
                disabled={pending || !draft.nome.trim()}
              >
                {draft.id ? "Salvar" : "Criar"}
              </Button>
              <Button
                variant="outline"
                className={btnOutline}
                onClick={cancelEdit}
                disabled={pending}
              >
                Cancelar
              </Button>
              {draft.id ? (
                <Button
                  variant="outline"
                  className={cn(btnDanger, "ml-auto")}
                  disabled={pending}
                  onClick={() => {
                    const p = parceiros.find((x) => x.id === draft.id);
                    if (p) handleExcluir(p);
                  }}
                >
                  Excluir
                </Button>
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
