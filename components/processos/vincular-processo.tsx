"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Link2, Plus, Scale, Search } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  criarProcessoDoCaso,
  desvincularProcessoDoCaso,
  vincularProcesso,
  type ResultadoProcessoDoCaso,
} from "@/lib/actions/casos";
import { fichaPessoaHref } from "@/lib/utils/ficha";
import { toastErroAcao } from "@/lib/client/erros";
import { formatCpf } from "@/lib/utils/cpf";
import { formatNumeroProcesso } from "@/lib/utils/processo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Input } from "@/components/ui/input";

export type ProcessoResumo = {
  id: number;
  nome: string;
  cpf: string;
  telefone: string | null;
  numero_processo: string | null;
  beneficio_identificado: string | null;
  caso_id: number | null;
};

export const PROCESSO_RESUMO_COLUNAS =
  "id, nome, cpf, telefone, numero_processo, beneficio_identificado, caso_id";

export function rotuloProcesso(p: ProcessoResumo) {
  return p.numero_processo
    ? formatNumeroProcesso(p.numero_processo)
    : `Sem número${p.beneficio_identificado ? ` · ${p.beneficio_identificado}` : ""}`;
}

/** Aviso depois de mover o card para "Abertura de processo". */
export function toastProcessoDoCaso(r: ResultadoProcessoDoCaso | undefined) {
  if (!r) return;
  if (!r.ok) {
    toast.warning(r.aviso, { duration: 8000 });
    return;
  }
  if (r.criado) {
    toast.success("Processo criado e ligado a este caso", {
      description: "Ele está sem número; adicione o número quando protocolar.",
      action: { label: "Ver", onClick: () => window.location.assign(r.href) },
    });
  }
}

/** Busca um processo que já existe e liga ao caso do funil e/ou à conversa. */
export function VincularProcessoDialog({
  open,
  onOpenChange,
  casoId,
  contactNorm,
  cpfSugestao,
  onVinculado,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  casoId?: number | null;
  contactNorm?: string | null;
  cpfSugestao?: string | null;
  onVinculado?: () => void;
}) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<ProcessoResumo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const termo = q.trim();
    const digitos = termo.replace(/\D/g, "");
    const cpf = cpfSugestao?.replace(/\D/g, "") ?? "";
    const timer = setTimeout(() => {
      setBuscando(true);
      let query = createClient()
        .from("processos_clientes")
        .select(PROCESSO_RESUMO_COLUNAS)
        .order("id", { ascending: false })
        .limit(15);
      if (termo) {
        const filtros = [`nome.ilike.%${termo.replace(/[,()%]/g, " ")}%`];
        if (digitos.length >= 3) {
          filtros.push(`cpf.ilike.%${digitos}%`, `numero_processo.ilike.%${digitos}%`);
        }
        query = query.or(filtros.join(","));
      } else if (cpf) {
        query = query.eq("cpf", cpf);
      }
      query.then(({ data }) => {
        setResultados((data as ProcessoResumo[] | null) ?? []);
        setBuscando(false);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, open, cpfSugestao]);

  const vincular = async (p: ProcessoResumo) => {
    setSalvando(p.id);
    try {
      await vincularProcesso({ processoId: p.id, casoId, contactNorm });
      toast.success(`Processo de ${p.nome} vinculado`);
      onOpenChange(false);
      onVinculado?.();
    } catch (err) {
      toastErroAcao(err, "Não foi possível vincular o processo");
    } finally {
      setSalvando(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Vincular a um processo</DialogTitle>
        <DialogDescription>
          {contactNorm
            ? "O processo fica ligado a esta conversa (e ao caso do funil, se houver)."
            : "O processo fica ligado a este caso do funil."}
        </DialogDescription>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome, CPF ou número do processo"
            className="pl-9"
          />
        </div>
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {buscando && resultados.length === 0 ? (
            <li className="px-2 py-3 text-sm text-muted-foreground">Buscando…</li>
          ) : resultados.length === 0 ? (
            <li className="px-2 py-3 text-sm text-muted-foreground">
              {q.trim() ? "Nenhum processo encontrado." : "Digite para buscar um processo."}
            </li>
          ) : (
            resultados.map((p) => {
              const jaDoCaso = casoId != null && p.caso_id === casoId;
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.nome}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatCpf(p.cpf)} · {rotuloProcesso(p)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={jaDoCaso ? "outline" : "default"}
                    disabled={jaDoCaso || salvando != null}
                    onClick={() => void vincular(p)}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    {jaDoCaso ? "Já vinculado" : "Vincular"}
                  </Button>
                </li>
              );
            })
          )}
        </ul>
        <p className="text-xs text-muted-foreground">
          Não achou? Cadastre em{" "}
          <Link href="/processos" className="font-medium text-primary underline-offset-2 hover:underline">
            Processos
          </Link>
          .
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** Processo(s) ligado(s) ao caso do funil, com criar / vincular / desvincular. */
export function ProcessosDoCaso({
  casoId,
  cpf,
  onAlterado,
}: {
  casoId: number;
  cpf?: string | null;
  onAlterado?: () => void;
}) {
  const [processos, setProcessos] = useState<ProcessoResumo[] | null>(null);
  const [vincularAberto, setVincularAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    createClient()
      .from("processos_clientes")
      .select(PROCESSO_RESUMO_COLUNAS)
      .eq("caso_id", casoId)
      .order("id", { ascending: true })
      .then(({ data }) => setProcessos((data as ProcessoResumo[] | null) ?? []));
  }, [casoId, versao]);

  const recarregar = () => {
    setVersao((v) => v + 1);
    onAlterado?.();
  };

  const criar = async () => {
    setOcupado(true);
    try {
      const r = await criarProcessoDoCaso(casoId);
      toastProcessoDoCaso(r);
      recarregar();
    } catch (err) {
      toastErroAcao(err, "Não foi possível criar o processo");
    } finally {
      setOcupado(false);
    }
  };

  const desvincular = async (p: ProcessoResumo) => {
    setOcupado(true);
    try {
      await desvincularProcessoDoCaso(p.id);
      toast.success("Processo desvinculado do caso");
      recarregar();
    } catch (err) {
      toastErroAcao(err, "Não foi possível desvincular");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Processo</p>
        <div className="flex flex-wrap gap-2">
          {processos && processos.length === 0 ? (
            <Button type="button" size="sm" disabled={ocupado} onClick={() => void criar()}>
              <Plus className="h-3.5 w-3.5" />
              Criar processo
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={ocupado}
            onClick={() => setVincularAberto(true)}
          >
            <Link2 className="h-3.5 w-3.5" />
            Vincular existente
          </Button>
        </div>
      </div>
      {processos === null ? (
        <p className="mt-2 text-sm text-muted-foreground">Carregando…</p>
      ) : processos.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nenhum processo ligado. Ele é criado sozinho quando a equipe move o card para
          &ldquo;Abertura de processo&rdquo;.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {processos.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <Link
                href={fichaPessoaHref({ cpf: p.cpf, contactNorm: p.telefone, aba: "datajud" })}
                className="min-w-0 flex-1 truncate font-medium text-primary underline-offset-2 hover:underline"
              >
                {rotuloProcesso(p)}
              </Link>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void desvincular(p)}
                className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
              >
                Desvincular
              </button>
            </li>
          ))}
        </ul>
      )}
      <VincularProcessoDialog
        open={vincularAberto}
        onOpenChange={setVincularAberto}
        casoId={casoId}
        cpfSugestao={cpf}
        onVinculado={recarregar}
      />
    </div>
  );
}

/** Botão "Processo" no topo da conversa: ver, vincular ou criar a partir do caso. */
export function ProcessoDaConversa({
  contactNorm,
  cpf,
  casoId,
}: {
  contactNorm: string;
  cpf?: string | null;
  casoId?: number | null;
}) {
  const [processos, setProcessos] = useState<ProcessoResumo[]>([]);
  const [vincularAberto, setVincularAberto] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    const filtros = [`telefone.eq.${contactNorm}`];
    if (cpf) filtros.push(`cpf.eq.${cpf.replace(/\D/g, "")}`);
    if (casoId) filtros.push(`caso_id.eq.${casoId}`);
    createClient()
      .from("processos_clientes")
      .select(PROCESSO_RESUMO_COLUNAS)
      .or(filtros.join(","))
      .order("id", { ascending: false })
      .limit(10)
      .then(({ data }) => setProcessos((data as ProcessoResumo[] | null) ?? []));
  }, [contactNorm, cpf, casoId, versao]);

  const criar = async () => {
    if (!casoId) return;
    try {
      const r = await criarProcessoDoCaso(casoId);
      toastProcessoDoCaso(r);
      if (r.ok && !r.criado) toast.info("Este caso já tem processo ligado");
      setVersao((v) => v + 1);
    } catch (err) {
      toastErroAcao(err, "Não foi possível criar o processo");
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#e2e8f0] bg-white px-3 text-xs font-medium text-[#0b2148] transition hover:border-[#0b2148]/30"
          aria-label="Processo do cliente"
        >
          <Scale className="h-3.5 w-3.5" />
          {processos.length ? `Processo (${processos.length})` : "Processo"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {processos.length ? "Processos deste cliente" : "Nenhum processo ligado"}
            </DropdownMenuLabel>
            {processos.map((p) => (
              <DropdownMenuItem
                key={p.id}
                render={
                  <Link href={fichaPessoaHref({ cpf: p.cpf, contactNorm: p.telefone, aba: "datajud" })} />
                }
              >
                <span className="min-w-0 truncate">{rotuloProcesso(p)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setVincularAberto(true)}>
            <Link2 className="h-4 w-4" />
            Vincular processo existente…
          </DropdownMenuItem>
          {casoId ? (
            <DropdownMenuItem onClick={() => void criar()}>
              <Plus className="h-4 w-4" />
              Criar processo a partir do caso
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <VincularProcessoDialog
        open={vincularAberto}
        onOpenChange={setVincularAberto}
        contactNorm={contactNorm}
        cpfSugestao={cpf}
        onVinculado={() => setVersao((v) => v + 1)}
      />
    </>
  );
}
