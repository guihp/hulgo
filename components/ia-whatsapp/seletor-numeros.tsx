"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { buscarContatosSistema, type ContatoSistema } from "@/lib/actions/ia-whatsapp";
import { formatPhone } from "@/lib/utils/phone";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Dígitos com DDI 55 (o servidor normaliza de novo ao salvar). */
function soNumero(v: string): string {
  const d = v.replace(/\D/g, "");
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

function telefoneLegivel(t: string) {
  return formatPhone(t.startsWith("55") ? t.slice(2) : t) || t;
}

/**
 * Lista de números escolhidos entre os contatos do sistema (busca por nome ou
 * número) — ou digitados à mão, se a pessoa ainda não escreveu para o escritório.
 */
export function SeletorNumeros(props: {
  id: string;
  valor: string[];
  onChange: (numeros: string[]) => void;
  /** Nome conhecido de cada número já salvo. */
  nomes: Record<string, string>;
  placeholder?: string;
}) {
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<ContatoSistema[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [nomesExtras, setNomesExtras] = useState<Record<string, string>>({});
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) return;
    let cancelado = false;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await buscarContatosSistema(termo);
        if (!cancelado) setResultados(r);
      } catch {
        if (!cancelado) setResultados([]);
      } finally {
        if (!cancelado) setBuscando(false);
      }
    }, 250);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [busca]);

  useEffect(() => {
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  const escolhidos = new Set(props.valor.map(soNumero));
  const digitado = soNumero(busca);
  const podeDigitar = digitado.length >= 12 && !escolhidos.has(digitado);
  const lista = busca.trim().length >= 2 ? resultados : [];

  function adicionar(telefone: string, nome?: string) {
    const t = soNumero(telefone);
    if (!t || escolhidos.has(t)) return;
    if (nome) setNomesExtras((n) => ({ ...n, [t]: nome }));
    props.onChange([...props.valor, t]);
    setBusca("");
    setResultados([]);
  }

  return (
    <div ref={caixa} className="flex flex-col gap-2">
      {props.valor.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {props.valor.map((n) => {
            const t = soNumero(n);
            const nome = nomesExtras[t] || props.nomes[t];
            return (
              <li
                key={t}
                className="flex items-center gap-1.5 rounded-full border border-[#e2e8f0] bg-slate-50 py-1 pl-3 pr-1 text-xs text-[#0b2148]"
              >
                <span className="font-medium">{nome || telefoneLegivel(t)}</span>
                {nome ? <span className="text-[#64748B]">{telefoneLegivel(t)}</span> : null}
                <button
                  type="button"
                  onClick={() => props.onChange(props.valor.filter((x) => soNumero(x) !== t))}
                  className="rounded-full p-0.5 text-[#64748B] hover:bg-slate-200 hover:text-[#0b2148]"
                  aria-label={`Remover ${nome || telefoneLegivel(t)}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-[#94a3b8]">Nenhum número escolhido.</p>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
        <Input
          id={props.id}
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (lista[0]) adicionar(lista[0].telefone, lista[0].nome);
              else if (podeDigitar) adicionar(digitado);
            }
            if (e.key === "Escape") setAberto(false);
          }}
          placeholder={props.placeholder ?? "Buscar contato pelo nome ou número…"}
          className="pl-8"
          autoComplete="off"
        />
        {aberto && busca.trim().length >= 2 ? (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-white shadow-lg">
            {buscando && !lista.length ? (
              <p className="p-3 text-sm text-[#94a3b8]">Buscando…</p>
            ) : null}
            {lista.map((c) => {
              const ja = escolhidos.has(c.telefone);
              return (
                <button
                  key={c.telefone}
                  type="button"
                  disabled={ja}
                  onClick={() => adicionar(c.telefone, c.nome)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50",
                    ja && "cursor-default opacity-50"
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-[#0b2148]">
                      {c.nome || telefoneLegivel(c.telefone)}
                    </span>
                    <span className="text-xs text-[#64748B]">{telefoneLegivel(c.telefone)}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-[#64748B]">
                    {ja ? "já está na lista" : c.origem}
                  </span>
                </button>
              );
            })}
            {podeDigitar && !lista.some((c) => c.telefone === digitado) ? (
              <button
                type="button"
                onClick={() => adicionar(digitado)}
                className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm text-[#0b2148] hover:bg-slate-50"
              >
                <Plus className="h-4 w-4" /> Adicionar o número {telefoneLegivel(digitado)}
              </button>
            ) : null}
            {!buscando && !lista.length && !podeDigitar ? (
              <p className="p-3 text-sm text-[#94a3b8]">
                Nenhum contato encontrado. Digite o número com DDD para adicionar.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
