"use client";

import { useState } from "react";
import { Check, Columns3, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  criarEtiqueta,
  editarEtiqueta,
  excluirEtiqueta,
} from "@/lib/actions/etiquetas";
import type { Tables } from "@/types/database";
import {
  corEtiqueta,
  ETIQUETA_COR_LISTA,
  ETIQUETA_CORES,
  ETIQUETA_NOME_MAX,
  type EtiquetaCor,
} from "@/lib/utils/etiquetas";
import { toastErroAcao } from "@/lib/client/erros";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type Etiqueta = Tables<"app_etiquetas">;

export function EtiquetaChip({
  etiqueta,
  className,
}: {
  etiqueta: Etiqueta;
  className?: string;
}) {
  const cor = corEtiqueta(etiqueta.cor);
  return (
    <span
      title={etiqueta.chave?.startsWith("funil:") ? `Etapa do funil: ${etiqueta.nome}` : etiqueta.nome}
      className={cn(
        "inline-flex max-w-[140px] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        cor.pill,
        className
      )}
    >
      {etiqueta.chave?.startsWith("funil:") ? (
        <Columns3 className="size-3 shrink-0" aria-label="Etapa do funil" />
      ) : (
        <span className={cn("size-1.5 shrink-0 rounded-full", cor.dot)} />
      )}
      <span className="truncate">{etiqueta.nome}</span>
    </span>
  );
}

export function EtiquetaDot({ cor }: { cor: string }) {
  return <span className={cn("size-2.5 shrink-0 rounded-full", corEtiqueta(cor).dot)} />;
}

function SeletorCor({
  valor,
  onChange,
}: {
  valor: EtiquetaCor;
  onChange: (c: EtiquetaCor) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ETIQUETA_COR_LISTA.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={ETIQUETA_CORES[c].label}
          title={ETIQUETA_CORES[c].label}
          className={cn(
            "flex size-6 items-center justify-center rounded-full ring-offset-2 transition",
            ETIQUETA_CORES[c].dot,
            valor === c ? "ring-2 ring-[#0b2148]" : "hover:ring-2 hover:ring-[#cbd5e1]"
          )}
        >
          {valor === c ? <Check className="size-3.5 text-white" /> : null}
        </button>
      ))}
    </div>
  );
}

function LinhaEtiqueta({
  etiqueta,
  usos,
  onAlterada,
}: {
  etiqueta: Etiqueta;
  usos: number;
  onAlterada: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(etiqueta.nome);
  const [cor, setCor] = useState<EtiquetaCor>(
    (etiqueta.cor in ETIQUETA_CORES ? etiqueta.cor : "cinza") as EtiquetaCor
  );
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [busy, setBusy] = useState(false);

  const salvar = async () => {
    setBusy(true);
    try {
      await editarEtiqueta({ id: etiqueta.id, nome, cor });
      setEditando(false);
      onAlterada();
    } catch (err) {
      toastErroAcao(err, "Não foi possível salvar a etiqueta");
    } finally {
      setBusy(false);
    }
  };

  const excluir = async () => {
    setBusy(true);
    try {
      await excluirEtiqueta(etiqueta.id);
      toast.success(`Etiqueta "${etiqueta.nome}" excluída`);
      onAlterada();
    } catch (err) {
      toastErroAcao(err, "Não foi possível excluir a etiqueta");
      setBusy(false);
    }
  };

  if (editando) {
    return (
      <li className="space-y-2 rounded-lg border border-[#e2e8f0] bg-[#F8FAFC] p-2.5">
        <Input
          value={nome}
          maxLength={ETIQUETA_NOME_MAX}
          autoFocus
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void salvar();
            if (e.key === "Escape") setEditando(false);
          }}
          className="h-9 bg-white"
        />
        <SeletorCor valor={cor} onChange={setCor} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditando(false)}>
            Cancelar
          </Button>
          <Button type="button" size="sm" disabled={busy || !nome.trim()} onClick={() => void salvar()}>
            Salvar
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#F8FAFC]">
      <EtiquetaDot cor={etiqueta.cor} />
      <span className="min-w-0 flex-1 truncate text-sm text-[#0b2148]">{etiqueta.nome}</span>
      <span className="shrink-0 text-xs text-[#94a3b8]">
        {usos === 1 ? "1 conversa" : `${usos} conversas`}
      </span>
      {etiqueta.chave ? (
        <span
          className="shrink-0 rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[11px] text-[#64748B]"
          title="Entra e sai sozinha conforme a IA ou a equipe assume a conversa."
        >
          automática
        </span>
      ) : confirmarExclusao ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void excluir()}
            className="h-7 px-2 text-xs"
          >
            Excluir
          </Button>
          <button
            type="button"
            onClick={() => setConfirmarExclusao(false)}
            className="rounded p-1 text-[#64748B] hover:bg-[#e2e8f0]"
            aria-label="Cancelar exclusão"
          >
            <X className="size-3.5" />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="rounded p-1 text-[#64748B] hover:bg-[#e2e8f0] hover:text-[#0b2148]"
            aria-label={`Editar ${etiqueta.nome}`}
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setConfirmarExclusao(true)}
            className="rounded p-1 text-[#64748B] hover:bg-rose-50 hover:text-rose-600"
            aria-label={`Excluir ${etiqueta.nome}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </>
      )}
    </li>
  );
}

/** Criar, renomear, trocar a cor e excluir etiquetas (valem para todo o escritório). */
export function GerenciarEtiquetasDialog({
  open,
  onOpenChange,
  etiquetas,
  usos,
  onAlteradas,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  etiquetas: Etiqueta[];
  usos: Record<number, number>;
  onAlteradas: () => void;
}) {
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState<EtiquetaCor>("azul");
  const [busy, setBusy] = useState(false);

  const criar = async () => {
    if (!nome.trim()) return;
    setBusy(true);
    try {
      await criarEtiqueta({ nome, cor });
      setNome("");
      onAlteradas();
    } catch (err) {
      toastErroAcao(err, "Não foi possível criar a etiqueta");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Etiquetas</DialogTitle>
        <DialogDescription>
          Use etiquetas para organizar as conversas. Elas valem para toda a equipe.
          &ldquo;IA atendendo&rdquo; e &ldquo;Atendimento humano&rdquo; entram e saem sozinhas.
        </DialogDescription>

        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {etiquetas.length === 0 ? (
            <li className="px-2 py-3 text-sm text-[#94a3b8]">Nenhuma etiqueta ainda.</li>
          ) : (
            etiquetas.map((e) => (
              <LinhaEtiqueta
                key={`${e.id}-${e.nome}-${e.cor}`}
                etiqueta={e}
                usos={usos[e.id] ?? 0}
                onAlterada={onAlteradas}
              />
            ))
          )}
        </ul>

        <div className="space-y-2 border-t border-[#e2e8f0] pt-3">
          <p className="text-sm font-medium text-[#0b2148]">Nova etiqueta</p>
          <div className="flex gap-2">
            <Input
              value={nome}
              maxLength={ETIQUETA_NOME_MAX}
              placeholder="Ex.: Aguardando perícia"
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void criar();
              }}
              className="h-9"
            />
            <Button
              type="button"
              size="sm"
              disabled={busy || !nome.trim()}
              onClick={() => void criar()}
              className="h-9 shrink-0"
            >
              <Plus className="size-4" />
              Criar
            </Button>
          </div>
          <SeletorCor valor={cor} onChange={setCor} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
