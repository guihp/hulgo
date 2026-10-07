"use client";

import { useState } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  FileDown,
  MoreVertical,
  Palette,
  Pencil,
} from "lucide-react";
import type { ProcessoColunaMatch } from "@/lib/data/processo-colunas";
import { abrirRelatorioProcessos } from "@/components/processos/relatorio-processos-button";
import { CORES_COLUNA_PROCESSO } from "@/lib/utils/processos";
import { COR_COLUNA_DOT, COR_COLUNA_LABEL, corDot } from "@/components/processos/cores";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const NAO_MOVER = "__nao_mover__";

export function ProcessoColunaMenu({
  coluna,
  colunas,
  processosCount,
  canMoveLeft,
  canMoveRight,
  canArchive,
  onRename,
  onCor,
  onMove,
  onArchive,
}: {
  coluna: ProcessoColunaMatch;
  colunas: ProcessoColunaMatch[];
  processosCount: number;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  canArchive: boolean;
  onRename: () => void;
  onCor: (cor: string | null) => void;
  onMove: (dir: -1 | 1) => void;
  /** `destino` = chave para onde mover os processos antes de arquivar (null = não mover). */
  onArchive: (destino: string | null) => Promise<boolean>;
}) {
  const outras = colunas.filter((c) => c.chave !== coluna.chave);
  const idx = colunas.findIndex((c) => c.chave === coluna.chave);
  const vizinha = colunas[idx - 1] ?? colunas[idx + 1] ?? null;

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [destino, setDestino] = useState<string>(vizinha?.chave ?? NAO_MOVER);
  const [archiving, setArchiving] = useState(false);

  function openArchive() {
    setDestino(vizinha?.chave ?? NAO_MOVER);
    setArchiveOpen(true);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-sm" }),
            "order-last -mr-1 shrink-0 text-muted-foreground"
          )}
          aria-label={`Editar coluna ${coluna.label}`}
          title="Editar coluna"
        >
          <MoreVertical className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={onRename}>
            <Pencil />
            Renomear
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Palette />
              Mudar cor
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              {CORES_COLUNA_PROCESSO.map((cor) => (
                <DropdownMenuItem key={cor} onClick={() => onCor(cor)}>
                  <span
                    className={cn("size-3 rounded-full", COR_COLUNA_DOT[cor])}
                    aria-hidden
                  />
                  {COR_COLUNA_LABEL[cor]}
                  {coluna.cor === cor ? <Check className="ml-auto" /> : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onCor(null)}>
                <span className="size-3 rounded-full border bg-slate-300" aria-hidden />
                Sem cor
                {!coluna.cor ? <Check className="ml-auto" /> : null}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={() => abrirRelatorioProcessos(coluna.funil, coluna.chave)}>
            <FileDown />
            Relatório PDF da coluna
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!canMoveLeft} onClick={() => onMove(-1)}>
            <ArrowLeft />
            Mover para esquerda
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canMoveRight} onClick={() => onMove(1)}>
            <ArrowRight />
            Mover para direita
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={!canArchive}
            onClick={openArchive}
          >
            <Archive />
            Arquivar coluna
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar a coluna &quot;{coluna.label}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              A coluna some do quadro, mas pode ser reativada em Configurações →
              Funis de processos.
              {processosCount > 0
                ? ` Ela tem ${processosCount} processo(s).`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {processosCount > 0 ? (
            <div className="space-y-2">
              <Label>Mover os processos para</Label>
              <Select value={destino} onValueChange={(v) => setDestino(v ?? NAO_MOVER)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string | null) =>
                      !v || v === NAO_MOVER
                        ? "Não mover"
                        : (outras.find((c) => c.chave === v)?.label ?? v)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {outras.map((c) => (
                    <SelectItem key={c.chave} value={c.chave}>
                      <span className={cn("size-2 rounded-full", corDot(c.cor))} aria-hidden />
                      {c.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={NAO_MOVER}>Não mover</SelectItem>
                </SelectContent>
              </Select>
              {destino === NAO_MOVER ? (
                <p className="text-xs text-muted-foreground">
                  Os processos aparecerão na primeira coluna ativa com o selo
                  &quot;Sem coluna ativa&quot; até serem movidos.
                </p>
              ) : null}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiving}
              variant="destructive"
              onClick={async (e) => {
                e.preventDefault();
                setArchiving(true);
                const ok = await onArchive(
                  processosCount > 0 && destino !== NAO_MOVER ? destino : null
                );
                setArchiving(false);
                if (ok) setArchiveOpen(false);
              }}
            >
              {archiving ? "Arquivando…" : "Arquivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
