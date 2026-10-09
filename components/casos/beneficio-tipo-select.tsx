"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  listarTiposCasoAtivosAction,
  type TipoCasoMatch,
} from "@/lib/actions/tipos-caso";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/client/erros";

const NONE = "__none__";

/** Resolve valor do select: prefer label do tipo; mantém texto órfão se não houver match. */
export function resolveBeneficioSelectValue(
  tipos: TipoCasoMatch[],
  current: string | null | undefined
): string {
  const b = (current ?? "").trim();
  if (!b) return NONE;

  const exact = tipos.find(
    (t) => t.label === b || t.chave === b || t.label.toLowerCase() === b.toLowerCase()
  );
  if (exact) return exact.label;

  const lower = b.toLowerCase();
  for (const t of tipos) {
    if (t.chave === "outro") continue;
    const aliases = t.aliases.length ? t.aliases : [t.label, t.chave];
    for (const alias of aliases) {
      const a = alias.toLowerCase().trim();
      if (a && lower.includes(a)) return t.label;
    }
    if (t.label && lower.includes(t.label.toLowerCase())) return t.label;
  }

  return b;
}

type BeneficioTipoSelectProps = {
  value: string | null | undefined;
  onChange: (label: string | null) => void;
  /** Tipos pré-carregados (evita fetch). */
  tipos?: TipoCasoMatch[];
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  id?: string;
  /** Placeholder quando nenhum benefício. */
  placeholder?: string;
};

export function BeneficioTipoSelect({
  value,
  onChange,
  tipos: tiposProp,
  disabled,
  className,
  triggerClassName,
  id,
  placeholder = "Selecionar tipo de caso",
}: BeneficioTipoSelectProps) {
  const [tiposLocal, setTiposLocal] = useState<TipoCasoMatch[] | null>(
    tiposProp ?? null
  );
  const [loading, setLoading] = useState(!tiposProp);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tiposProp) {
      setTiposLocal(tiposProp);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listarTiposCasoAtivosAction()
      .then((list) => {
        if (!cancelled) {
          setTiposLocal(list);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setTiposLocal([]);
          setError(mensagemErro(err, "Erro ao carregar tipos"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tiposProp]);

  const tipos = tiposLocal ?? [];
  const selectValue = useMemo(
    () => resolveBeneficioSelectValue(tipos, value),
    [tipos, value]
  );

  const orphan =
    selectValue !== NONE && !tipos.some((t) => t.label === selectValue)
      ? selectValue
      : null;

  if (!loading && tipos.length === 0 && !orphan) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        Nenhum tipo de caso cadastrado.{" "}
        <Link
          href="/configuracoes?tab=tipos"
          className="font-medium text-[#0b2148] underline-offset-2 hover:underline"
        >
          Configurar em Tipos de caso
        </Link>
      </p>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      <Select
        value={selectValue}
        disabled={disabled || loading}
        onValueChange={(v) => {
          if (v == null || v === NONE) onChange(null);
          else onChange(v);
        }}
      >
        <SelectTrigger id={id} className={cn("w-full", triggerClassName)}>
          <SelectValue placeholder={loading ? "Carregando…" : placeholder}>
            {(v: string | null) =>
              !v || v === NONE ? "Benefício não identificado" : v
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Benefício não identificado</SelectItem>
          {orphan ? (
            <SelectItem value={orphan}>{orphan} (atual)</SelectItem>
          ) : null}
          {tipos.map((t) => (
            <SelectItem key={t.id ?? t.chave} value={t.label}>
              {t.label}
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
