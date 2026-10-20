"use client";

import { useState } from "react";
import { ChevronDown, FileDown, Handshake, Layers, LayoutList } from "lucide-react";
import type { ProcessoColunaMatch } from "@/lib/data/processo-colunas";
import type { Parceiro } from "@/lib/actions/parceiros";
import { relatorioProcessosHref } from "@/lib/relatorios/processos-href";
import { labelFunilProcesso, type FunilProcesso } from "@/lib/utils/processos";
import { corDot } from "@/components/processos/cores";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function abrirRelatorioProcessos(
  funil?: FunilProcesso | "todos",
  coluna?: string,
  parceiro?: string
) {
  window.open(relatorioProcessosHref({ funil, coluna, parceiro }), "_blank", "noopener");
}

const SEM_PARCEIRO = "sem";
const TODAS = "__todas";

function RelatorioParceiroDialog({
  open,
  onOpenChange,
  funil,
  colunas,
  parceiros,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  funil: FunilProcesso;
  colunas: ProcessoColunaMatch[];
  parceiros: Parceiro[];
}) {
  const [parceiro, setParceiro] = useState<string | null>(null);
  const [escopo, setEscopo] = useState<"todos" | "funil">("todos");
  const [coluna, setColuna] = useState<string>(TODAS);

  const nomeParceiro = (v: string | null) =>
    v === SEM_PARCEIRO
      ? "Processos sem parceiro"
      : parceiros.find((p) => p.id === v)?.nome ?? "Escolha o parceiro";

  const gerar = () => {
    if (!parceiro) return;
    if (escopo === "todos") abrirRelatorioProcessos("todos", undefined, parceiro);
    else abrirRelatorioProcessos(funil, coluna === TODAS ? undefined : coluna, parceiro);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Relatório por parceiro</DialogTitle>
          <DialogDescription>
            Gera o PDF só com os processos do parceiro escolhido.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Parceiro</Label>
            <Select value={parceiro} onValueChange={(v) => setParceiro(v as string | null)}>
              <SelectTrigger className="w-full" aria-label="Parceiro">
                <SelectValue>{(v: string | null) => nomeParceiro(v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {parceiros.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome}
                    {p.cidade ? <span className="text-muted-foreground"> · {p.cidade}</span> : null}
                  </SelectItem>
                ))}
                <SelectItem value={SEM_PARCEIRO}>Processos sem parceiro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Quais processos</Label>
            <Select
              value={escopo}
              onValueChange={(v) => setEscopo((v as "todos" | "funil") ?? "todos")}
            >
              <SelectTrigger className="w-full" aria-label="Quais processos">
                <SelectValue>
                  {(v: string | null) =>
                    v === "funil" ? `Só ${labelFunilProcesso(funil)}` : "Todos os funis"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os funis</SelectItem>
                <SelectItem value="funil">Só {labelFunilProcesso(funil)}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {escopo === "funil" ? (
            <div className="space-y-1.5">
              <Label>Coluna</Label>
              <Select value={coluna} onValueChange={(v) => setColuna((v as string) ?? TODAS)}>
                <SelectTrigger className="w-full" aria-label="Coluna">
                  <SelectValue>
                    {(v: string | null) =>
                      v === TODAS || !v
                        ? "Todas as colunas"
                        : colunas.find((c) => c.chave === v)?.label ?? v
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODAS}>Todas as colunas</SelectItem>
                  {colunas.map((c) => (
                    <SelectItem key={c.chave} value={c.chave}>
                      <span className={cn("size-2.5 shrink-0 rounded-full", corDot(c.cor))} aria-hidden />
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={!parceiro} onClick={gerar}>
            <FileDown className="size-4" />
            Gerar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RelatorioProcessosButton({
  funil,
  colunas,
  parceiros = [],
}: {
  funil: FunilProcesso;
  colunas: ProcessoColunaMatch[];
  parceiros?: Parceiro[];
}) {
  const [parceiroOpen, setParceiroOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}
        >
          <FileDown className="size-4" />
          Relatório PDF
          <ChevronDown className="size-3.5 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{labelFunilProcesso(funil)}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => abrirRelatorioProcessos(funil)}>
              <LayoutList />
              Funil inteiro — todas as colunas
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Somente uma coluna</DropdownMenuLabel>
            {colunas.map((c) => (
              <DropdownMenuItem
                key={c.chave}
                onClick={() => abrirRelatorioProcessos(funil, c.chave)}
              >
                <span className={cn("size-2.5 shrink-0 rounded-full", corDot(c.cor))} aria-hidden />
                <span className="truncate">{c.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => abrirRelatorioProcessos("todos")}>
            <Layers />
            Todos os funis
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setParceiroOpen(true)}>
            <Handshake />
            Por parceiro…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RelatorioParceiroDialog
        open={parceiroOpen}
        onOpenChange={setParceiroOpen}
        funil={funil}
        colunas={colunas}
        parceiros={parceiros}
      />
    </>
  );
}
