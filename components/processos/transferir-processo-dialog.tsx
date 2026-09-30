"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { transferirProcessos } from "@/lib/actions/casos";
import {
  listarProcessoColunasAction,
  type ProcessoColunaMatch,
} from "@/lib/actions/processo-colunas";
import {
  FUNIS_PROCESSO,
  isFunilProcesso,
  labelFunilProcesso,
  type FunilProcesso,
} from "@/lib/utils/processos";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { corDot } from "@/components/processos/cores";
import { cn } from "@/lib/utils";

export type TransferenciaResultado = {
  ids: number[];
  funil: FunilProcesso;
  coluna: string;
};

export function TransferirProcessoDialog({
  ids,
  funilAtual,
  open,
  onOpenChange,
  descricao,
  onTransferred,
}: {
  ids: number[];
  /** Funil de origem (quando todos são do mesmo) — sai da lista de destinos. */
  funilAtual?: FunilProcesso | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  descricao?: string;
  onTransferred?: (r: TransferenciaResultado) => void;
}) {
  const router = useRouter();
  const destinos = FUNIS_PROCESSO.filter((f) => f.value !== funilAtual);
  const [funil, setFunil] = useState<FunilProcesso>(destinos[0].value);
  const [coluna, setColuna] = useState("");
  const [colunasState, setColunasState] = useState<{
    funil: FunilProcesso | null;
    list: ProcessoColunaMatch[];
  }>({ funil: null, list: [] });
  const [pending, startTransition] = useTransition();
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setFunil(destinos[0].value);
      setColuna("");
    }
  }

  const colunas = colunasState.funil === funil ? colunasState.list : [];
  const loading = open && colunasState.funil !== funil;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listarProcessoColunasAction(funil)
      .then((list) => {
        if (cancelled) return;
        const ativas = list.filter((c) => c.ativo);
        setColunasState({ funil, list: ativas });
        setColuna((prev) =>
          ativas.some((c) => c.chave === prev) ? prev : ativas[0]?.chave ?? ""
        );
      })
      .catch(() => {
        if (!cancelled) setColunasState({ funil, list: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [open, funil]);

  function confirmar() {
    if (!ids.length) return;
    startTransition(async () => {
      try {
        const res = await transferirProcessos(ids, funil, coluna || null);
        toast.success(
          res.count > 1
            ? `${res.count} processos transferidos para ${labelFunilProcesso(funil)}`
            : `Processo transferido para ${labelFunilProcesso(funil)}`,
          { description: `Coluna: ${res.colunaLabel}` }
        );
        onOpenChange(false);
        onTransferred?.({ ids, funil, coluna: res.coluna });
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao transferir");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {ids.length > 1
              ? `Transferir ${ids.length} processos`
              : "Transferir processo"}
          </DialogTitle>
          <DialogDescription>
            {descricao ??
              (funilAtual
                ? `Hoje em ${labelFunilProcesso(funilAtual)}. Escolha o funil e a coluna de destino.`
                : "Escolha o funil e a coluna de destino.")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="transferir-funil">Funil de destino</Label>
            <Select
              value={funil}
              onValueChange={(v) => {
                if (isFunilProcesso(v)) setFunil(v);
              }}
            >
              <SelectTrigger id="transferir-funil" className="w-full">
                <SelectValue>{(v) => labelFunilProcesso(v as string)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {destinos.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="transferir-coluna">Coluna de destino</Label>
            <Select
              value={coluna || null}
              onValueChange={(v) => setColuna((v as string | null) ?? "")}
              disabled={loading || colunas.length === 0}
            >
              <SelectTrigger id="transferir-coluna" className="w-full">
                <SelectValue placeholder={loading ? "Carregando…" : "Primeira coluna"}>
                  {(v) => {
                    if (!v) return loading ? "Carregando…" : "Primeira coluna";
                    return colunas.find((c) => c.chave === v)?.label ?? String(v);
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {colunas.map((c) => (
                  <SelectItem key={c.chave} value={c.chave}>
                    <span className={cn("size-2 rounded-full", corDot(c.cor))} aria-hidden />
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={pending || loading || !ids.length}>
            {pending ? "Transferindo…" : "Transferir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
