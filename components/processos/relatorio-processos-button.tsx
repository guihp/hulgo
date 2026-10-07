"use client";

import { ChevronDown, FileDown, Layers, LayoutList } from "lucide-react";
import type { ProcessoColunaMatch } from "@/lib/data/processo-colunas";
import { relatorioProcessosHref } from "@/lib/relatorios/processos-href";
import { labelFunilProcesso, type FunilProcesso } from "@/lib/utils/processos";
import { corDot } from "@/components/processos/cores";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function abrirRelatorioProcessos(funil?: FunilProcesso | "todos", coluna?: string) {
  window.open(relatorioProcessosHref({ funil, coluna }), "_blank", "noopener");
}

export function RelatorioProcessosButton({
  funil,
  colunas,
}: {
  funil: FunilProcesso;
  colunas: ProcessoColunaMatch[];
}) {
  return (
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
