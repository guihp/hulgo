"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  listarKanbanColunasAction,
  type KanbanColunaMatch,
} from "@/lib/actions/kanban-colunas";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/client/erros";

type ColunaKanbanSelectProps = {
  value: string | null | undefined;
  onChange: (chave: string) => void;
  colunas?: KanbanColunaMatch[];
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  id?: string;
  placeholder?: string;
  /** Se true, exige escolher uma coluna (sem valor vazio). */
  required?: boolean;
};

export function ColunaKanbanSelect({
  value,
  onChange,
  colunas: colunasProp,
  disabled,
  className,
  triggerClassName,
  id,
  placeholder = "Selecionar coluna do funil",
}: ColunaKanbanSelectProps) {
  const [colunasLocal, setColunasLocal] = useState<KanbanColunaMatch[] | null>(
    colunasProp ?? null
  );
  const [loading, setLoading] = useState(!colunasProp);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (colunasProp) {
      setColunasLocal(colunasProp);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listarKanbanColunasAction(false)
      .then((list) => {
        if (!cancelled) {
          setColunasLocal(list);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setColunasLocal([]);
          setError(
            mensagemErro(err, "Erro ao carregar colunas")
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [colunasProp]);

  const colunas = useMemo(
    () => (colunasLocal ?? []).filter((c) => c.ativo),
    [colunasLocal]
  );

  const selectValue = useMemo(() => {
    const v = (value ?? "").trim();
    if (!v) return "";
    if (colunas.some((c) => c.chave === v)) return v;
    return v;
  }, [value, colunas]);

  const orphan =
    selectValue && !colunas.some((c) => c.chave === selectValue)
      ? selectValue
      : null;

  if (!loading && colunas.length === 0 && !orphan) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        Nenhuma coluna ativa. Cadastre em{" "}
        <Link
          href="/configuracoes?tab=funil"
          className="font-medium text-[#0b2148] underline underline-offset-2"
        >
          Configurações → Colunas do funil
        </Link>
        .
      </p>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      <Select
        value={selectValue || undefined}
        onValueChange={(v) => {
          if (v) onChange(v);
        }}
        disabled={disabled || loading}
      >
        <SelectTrigger id={id} className={cn("w-full", triggerClassName)}>
          <SelectValue placeholder={loading ? "Carregando…" : placeholder}>
            {(chave: string | null) => {
              if (!chave) return null;
              return (
                colunas.find((c) => c.chave === chave)?.label ?? chave
              );
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {orphan ? (
            <SelectItem value={orphan}>{orphan} (inativa)</SelectItem>
          ) : null}
          {colunas.map((c) => (
            <SelectItem key={c.chave} value={c.chave}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
