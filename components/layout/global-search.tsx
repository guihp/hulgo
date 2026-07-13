"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSearch, Kanban, MessageSquare, Search, User } from "lucide-react";
import { buscarGlobal, type ResultadoBusca } from "@/lib/actions/busca";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const tipoIcon = {
  cliente: User,
  caso: Kanban,
  conversa: MessageSquare,
} as const;

const tipoLabel = {
  cliente: "Cliente",
  caso: "Caso",
  conversa: "Conversa",
} as const;

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<ResultadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setTermo("");
      setResultados([]);
    }
  }, [open]);

  function onChange(value: string) {
    setTermo(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setResultados([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setBuscando(true);
      try {
        setResultados(await buscarGlobal(value));
      } finally {
        setBuscando(false);
      }
    }, 300);
  }

  function irPara(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <Button
        variant="outline"
        className="hidden gap-2 text-muted-foreground sm:flex"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" />
        <span className="hidden md:inline">Buscar…</span>
        <kbd className="pointer-events-none hidden rounded border bg-muted px-1.5 text-[10px] md:inline">
          ⌘K
        </kbd>
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="sm:hidden"
        onClick={() => setOpen(true)}
        aria-label="Buscar"
      >
        <Search className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[20%] translate-y-0 p-0 sm:max-w-lg">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle className="sr-only">Busca global</DialogTitle>
          </DialogHeader>
          <div className="px-4 pb-4">
            <Input
              autoFocus
              placeholder="Nome, CPF, telefone ou nº de processo…"
              value={termo}
              onChange={(e) => onChange(e.target.value)}
            />
            <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
              {buscando && (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  Buscando…
                </p>
              )}
              {!buscando && termo.trim().length >= 2 && resultados.length === 0 && (
                <p className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                  <FileSearch className="h-4 w-4" /> Nada encontrado.
                </p>
              )}
              {resultados.map((r, i) => {
                const Icon = tipoIcon[r.tipo];
                return (
                  <button
                    key={`${r.href}-${i}`}
                    onClick={() => irPara(r.href)}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {r.titulo}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.subtitulo}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {tipoLabel[r.tipo]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
