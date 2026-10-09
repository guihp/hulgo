"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { differenceInDays, differenceInHours } from "date-fns";
import {
  ArrowLeft,
  CheckCircle,
  ExternalLink,
  FileText,
  Kanban,
  MessageSquare,
  Search,
  Send,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  decidirAprovacao,
  getAprovacaoContexto,
  type AprovacaoContexto,
} from "@/lib/actions/aprovacoes";
import type { AppUser } from "@/lib/actions/auth";
import type { Tables } from "@/types/database";
import { APROVACAO_STATUS, CASO_STATUS } from "@/lib/constants";
import { CpfDisplay } from "@/components/shared/cpf-display";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatRelative, formatChatTime } from "@/lib/utils/dates";
import { formatPhone } from "@/lib/utils/phone";
import { fichaPessoaHref } from "@/lib/utils/ficha";
import { cn } from "@/lib/utils";
import { toastErroAcao } from "@/lib/client/erros";

type Aprovacao = Tables<"aprovacoes_pendentes">;

const MENSAGEM_RECUSA_PADRAO =
  "Olá! O advogado analisou sua solicitação e vai entrar em contato em breve para tratar do seu caso pessoalmente.";

type FiltroPill = "pendentes" | "aprovadas" | "recusadas" | "todas";

function initialsFromName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function diasAguardando(createdAt: string | null): number {
  if (!createdAt) return 0;
  return Math.max(0, differenceInDays(new Date(), new Date(createdAt)));
}

function urgenciaHoras(createdAt: string | null) {
  const horas = createdAt
    ? differenceInHours(new Date(), new Date(createdAt))
    : 0;
  if (horas >= 24) return "alta" as const;
  if (horas >= 2) return "media" as const;
  return "baixa" as const;
}

function statusLabel(status: string | null) {
  return (
    APROVACAO_STATUS.find((s) => s.value === status)?.label ?? status ?? "—"
  );
}

function statusBadgeClasses(status: string | null) {
  switch (status) {
    case "pendente":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "aprovado":
    case "respondido_manual":
      return "border-[#0b2148]/20 bg-[#0b2148]/8 text-[#0b2148]";
    case "recusado":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function matchesFiltro(a: Aprovacao, filtro: FiltroPill) {
  switch (filtro) {
    case "pendentes":
      return a.status === "pendente";
    case "aprovadas":
      return a.status === "aprovado" || a.status === "respondido_manual";
    case "recusadas":
      return a.status === "recusado";
    default:
      return true;
  }
}

function deriveBaseAnalise(
  aprovacao: Aprovacao,
  contexto: AprovacaoContexto | null
): string[] {
  const items: string[] = [];
  if (aprovacao.numero_processo) {
    items.push(`Processo consultado: ${aprovacao.numero_processo}`);
  }
  const proc = contexto?.processos.find(
    (p) => p.numero_processo === aprovacao.numero_processo
  );
  if (proc?.tribunal) {
    items.push(`Tribunal / órgão: ${proc.tribunal}${proc.area ? ` · ${proc.area}` : ""}`);
  }
  if (contexto?.casoFunil?.beneficio_identificado) {
    items.push(`Benefício no funil: ${contexto.casoFunil.beneficio_identificado}`);
  }
  const ultimaUser = [...(contexto?.mensagens ?? [])]
    .reverse()
    .find((m) => m.type === "user" && m.text?.trim());
  if (ultimaUser?.text) {
    const snippet =
      ultimaUser.text.length > 120
        ? `${ultimaUser.text.slice(0, 117)}…`
        : ultimaUser.text;
    items.push(`Última mensagem do cliente: “${snippet}”`);
  }
  if (contexto?.anteriores.length) {
    items.push(
      `${contexto.anteriores.length} aprovação(ões) anterior(es) deste CPF na base`
    );
  }
  return items;
}

function sortFiltradas(list: Aprovacao[]) {
  return [...list].sort((a, b) => {
    const ap = a.status === "pendente" ? 0 : 1;
    const bp = b.status === "pendente" ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const ta = new Date(a.created_at ?? 0).getTime();
    const tb = new Date(b.created_at ?? 0).getTime();
    return ap === 0 ? ta - tb : tb - ta;
  });
}

/* ================= MASTER-DETAIL LISTA ================= */

export function AprovacoesList({
  initial,
  user,
}: {
  initial: Aprovacao[];
  user: AppUser;
}) {
  const [aprovacoes, setAprovacoes] = useState<Aprovacao[]>(initial);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroPill>("pendentes");
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const first = initial.find((a) => a.status === "pendente");
    return first?.id ?? initial[0]?.id ?? null;
  });
  const [mobileDetail, setMobileDetail] = useState(false);
  const [contexto, setContexto] = useState<AprovacaoContexto | null>(null);
  const [contextoLoading, setContextoLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("aprovacoes_pendentes")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setAprovacoes(data);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("aprovacoes-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "aprovacoes_pendentes" },
        () => refresh()
      )
      .subscribe();
    const interval = setInterval(refresh, 45000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [refresh]);

  const counts = useMemo(() => {
    const pendentes = aprovacoes.filter((a) => a.status === "pendente").length;
    const aprovadas = aprovacoes.filter(
      (a) => a.status === "aprovado" || a.status === "respondido_manual"
    ).length;
    const recusadas = aprovacoes.filter((a) => a.status === "recusado").length;
    return { pendentes, aprovadas, recusadas, todas: aprovacoes.length };
  }, [aprovacoes]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return sortFiltradas(
      aprovacoes.filter((a) => {
        if (!matchesFiltro(a, filtro)) return false;
        if (!q) return true;
        return [a.nome_cliente, a.cpf, a.numero_processo, a.telefone_cliente]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
    );
  }, [aprovacoes, busca, filtro]);

  useEffect(() => {
    if (!filtradas.length) {
      setSelectedId(null);
      return;
    }
    if (!filtradas.some((a) => a.id === selectedId)) {
      setSelectedId(filtradas[0].id);
    }
  }, [filtradas, selectedId]);

  const selected = useMemo(
    () => aprovacoes.find((a) => a.id === selectedId) ?? null,
    [aprovacoes, selectedId]
  );

  useEffect(() => {
    if (!selectedId) {
      setContexto(null);
      return;
    }
    let cancelled = false;
    setContextoLoading(true);
    getAprovacaoContexto(selectedId)
      .then((ctx) => {
        if (!cancelled) setContexto(ctx);
      })
      .finally(() => {
        if (!cancelled) setContextoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function aprovarTodosPendentes() {
    if (user.papel !== "advogado") {
      toast.error("Apenas advogados podem aprovar pendências");
      return;
    }
    const pendentes = aprovacoes.filter((a) => a.status === "pendente");
    if (!pendentes.length) {
      toast.info("Não há pendências para aprovar");
      return;
    }
    setBulkLoading(true);
    let ok = 0;
    let fail = 0;
    for (const a of pendentes) {
      try {
        await decidirAprovacao({
          id: a.id,
          acao: "aprovar",
          texto: a.resumo,
        });
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkLoading(false);
    await refresh();
    if (ok) toast.success(`${ok} aprovação(ões) enviada(s) ao WhatsApp`);
    if (fail) toast.error(`${fail} falha(s) — verifique a fila`);
  }

  const pills: { key: FiltroPill; label: string; count?: number }[] = [
    { key: "pendentes", label: "Pendentes", count: counts.pendentes },
    { key: "aprovadas", label: "Aprovadas", count: counts.aprovadas },
    { key: "recusadas", label: "Recusadas", count: counts.recusadas },
    { key: "todas", label: "Todas", count: counts.todas },
  ];

  if (aprovacoes.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader />
        <EmptyState
          icon={CheckCircle}
          title="Fila de aprovações vazia"
          description="Quando a IA gerar um resumo de processo, ele aparecerá aqui para sua revisão."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-4">
      <PageHeader />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {pills.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setFiltro(p.key)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                filtro === p.key
                  ? "border-[#0b2148] bg-[#0b2148] text-white shadow-sm"
                  : "border-[#e2e8f0] bg-white text-[#64748B] hover:border-[#0b2148]/30 hover:text-[#0b2148]"
              )}
            >
              {p.label}
              {p.count !== undefined ? ` (${p.count})` : ""}
            </button>
          ))}
        </div>
        <AlertDialog>
          <AlertDialogTrigger
            disabled={bulkLoading || counts.pendentes === 0}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "shrink-0 border-[#0b2148]/25 text-[#0b2148] hover:bg-[#0b2148]/5"
            )}
          >
            Aprovar todos os pendentes
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Aprovar todas as pendências?</AlertDialogTitle>
              <AlertDialogDescription>
                Serão enviadas {counts.pendentes} mensagem(ns) com o resumo original
                da IA, uma a uma. Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => void aprovarTodosPendentes()}>
                Confirmar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
        <Input
          placeholder="Buscar por nome, CPF, processo ou telefone…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="h-11 border-[#e2e8f0] bg-white pl-9 text-[#0b2148] placeholder:text-[#94a3b8]"
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div
          className={cn(
            "flex min-h-0 flex-col gap-2 overflow-hidden",
            mobileDetail && "hidden lg:flex"
          )}
        >
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {filtradas.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#e2e8f0] bg-white p-6 text-center text-sm text-[#64748B]">
                Nenhum resultado para os filtros atuais.
              </div>
            ) : (
              filtradas.map((a) => (
                <ListCard
                  key={a.id}
                  aprovacao={a}
                  selected={a.id === selectedId}
                  beneficio={
                    a.id === selectedId
                      ? contexto?.casoFunil?.beneficio_identificado
                      : undefined
                  }
                  onSelect={() => {
                    setSelectedId(a.id);
                    setMobileDetail(true);
                  }}
                />
              ))
            )}
          </div>
        </div>

        <div
          className={cn(
            "min-h-0 overflow-y-auto",
            !mobileDetail && "hidden lg:block"
          )}
        >
          {selected ? (
            <div className="space-y-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="lg:hidden"
                onClick={() => setMobileDetail(false)}
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Voltar à lista
              </Button>
              <AprovacaoDetailPanel
                aprovacao={selected}
                user={user}
                contexto={contexto}
                contextoLoading={contextoLoading}
                onDecided={() => void refresh()}
              />
            </div>
          ) : (
            <div className="flex h-full min-h-[280px] items-center justify-center rounded-xl border border-dashed border-[#e2e8f0] bg-white p-8 text-sm text-[#64748B]">
              Selecione uma aprovação na lista
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-[#0b2148]">
        Aprovações
      </h1>
      <p className="text-sm text-[#64748B]">
        Resumos gerados pela IA ficam pausados até você aprovar, recusar ou
        responder — o cliente aguarda no WhatsApp enquanto isso
      </p>
    </div>
  );
}

function ListCard({
  aprovacao,
  selected,
  beneficio,
  onSelect,
}: {
  aprovacao: Aprovacao;
  selected: boolean;
  beneficio?: string | null;
  onSelect: () => void;
}) {
  const pendente = aprovacao.status === "pendente";
  const dias = diasAguardando(aprovacao.created_at);
  const snippet = aprovacao.resumo.trim().replace(/\s+/g, " ");
  const urg = urgenciaHoras(aprovacao.created_at);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-xl border bg-white p-4 text-left shadow-sm transition hover:shadow-md",
        selected
          ? "border-2 border-[#0b2148] ring-1 ring-[#0b2148]/10"
          : "border-[#e2e8f0] hover:border-[#0b2148]/25"
      )}
    >
      <div className="flex gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#0b2148]/10 text-sm font-semibold text-[#0b2148]">
          {initialsFromName(aprovacao.nome_cliente)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-[#0b2148]">
              {aprovacao.nome_cliente ?? "Cliente"}
            </p>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                statusBadgeClasses(aprovacao.status)
              )}
            >
              {statusLabel(aprovacao.status)}
            </span>
          </div>
          {(beneficio || aprovacao.numero_processo) && (
            <p className="mt-0.5 truncate text-xs text-[#64748B]">
              {beneficio ?? "Consulta processual"}
              {aprovacao.numero_processo
                ? ` · ${aprovacao.numero_processo.slice(-8)}`
                : ""}
            </p>
          )}
          <p className="mt-2 line-clamp-2 text-sm text-[#475569]">{snippet}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {pendente && (
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11px] font-medium",
                  urg === "alta"
                    ? "bg-red-50 text-red-700"
                    : urg === "media"
                      ? "bg-amber-50 text-amber-800"
                      : "bg-slate-100 text-slate-600"
                )}
              >
                {dias > 0
                  ? `aguardando há ${dias} dia${dias === 1 ? "" : "s"}`
                  : `aguardando ${formatRelative(aprovacao.created_at)}`}
              </span>
            )}
            {aprovacao.numero_processo && (
              <span className="rounded-md bg-[#F1F5F9] px-2 py-0.5 text-[11px] text-[#64748B]">
                {aprovacao.numero_processo.length > 20
                  ? `…${aprovacao.numero_processo.slice(-15)}`
                  : aprovacao.numero_processo}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

/* ================= DETALHE (painel + página) ================= */

export function AprovacaoDetail({
  aprovacao,
  user,
  contexto,
  variant = "page",
}: {
  aprovacao: Aprovacao;
  user: AppUser;
  contexto: AprovacaoContexto;
  variant?: "page" | "embedded";
}) {
  return (
    <AprovacaoDetailPanel
      aprovacao={aprovacao}
      user={user}
      contexto={contexto}
      contextoLoading={false}
      variant={variant}
    />
  );
}

function AprovacaoDetailPanel({
  aprovacao,
  user,
  contexto,
  contextoLoading,
  onDecided,
  variant = "embedded",
}: {
  aprovacao: Aprovacao;
  user: AppUser;
  contexto: AprovacaoContexto | null;
  contextoLoading: boolean;
  onDecided?: () => void;
  variant?: "page" | "embedded";
}) {
  const router = useRouter();
  const isAdvogado = user.papel === "advogado";
  const isPendente = aprovacao.status === "pendente";

  const [texto, setTexto] = useState(aprovacao.resumo);
  const [modoResposta, setModoResposta] = useState(false);
  const [respostaManual, setRespostaManual] = useState("");
  const [motivoRecusa, setMotivoRecusa] = useState("");
  const [msgRecusa, setMsgRecusa] = useState(MENSAGEM_RECUSA_PADRAO);
  const [enviarMsgRecusa, setEnviarMsgRecusa] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTexto(aprovacao.resumo);
    setModoResposta(false);
    setRespostaManual("");
    setMotivoRecusa("");
    setMsgRecusa(MENSAGEM_RECUSA_PADRAO);
  }, [aprovacao.id, aprovacao.resumo]);

  const editado = texto.trim() !== aprovacao.resumo.trim();
  const baseAnalise = useMemo(
    () => deriveBaseAnalise(aprovacao, contexto),
    [aprovacao, contexto]
  );
  const beneficio =
    contexto?.casoFunil?.beneficio_identificado ?? "Consulta processual";

  async function decidir(
    acao: "aprovar" | "responder" | "recusar",
    conteudo?: string,
    motivo?: string
  ) {
    setLoading(true);
    try {
      const result = await decidirAprovacao({
        id: aprovacao.id,
        acao,
        texto: conteudo,
        motivoRecusa: motivo,
      });
      if (result.mensagemEnviada) {
        toast.success("Mensagem enviada ao cliente pelo WhatsApp");
      } else {
        toast.success("Decisão registrada");
      }
      if (result.warning) toast.warning(result.warning);
      if (result.webhook.configured && !result.webhook.ok) {
        toast.warning("Decisão salva, mas o n8n não confirmou o despause da IA", {
          description: "Verifique o fluxo de despause no n8n.",
        });
      }
      onDecided?.();
      router.refresh();
    } catch (err) {
      toastErroAcao(err, "Erro ao processar");
    } finally {
      setLoading(false);
    }
  }

  const conversaHref = contexto?.contactNorm
    ? `/atendimentos/${contexto.contactNorm}`
    : null;

  return (
    <Card
      className={cn(
        "border-[#e2e8f0] bg-white shadow-sm",
        variant === "embedded" && "min-h-[480px]"
      )}
    >
      <CardContent className="space-y-6 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-[#0b2148] text-xl font-semibold text-white">
            {initialsFromName(aprovacao.nome_cliente)}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-[#0b2148]">
                {aprovacao.nome_cliente ?? "Cliente"}
              </h2>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                  statusBadgeClasses(aprovacao.status)
                )}
              >
                {statusLabel(aprovacao.status)}
              </span>
              {isPendente && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  Atendimento pausado
                </span>
              )}
              {editado && isPendente && (
                <Badge variant="outline" className="text-[#0b2148]">
                  mensagem editada
                </Badge>
              )}
            </div>
            <p className="text-sm text-[#64748B]">{beneficio}</p>
            <p className="text-xs text-[#94a3b8]">
              Recebido {formatRelative(aprovacao.created_at)} ·{" "}
              {formatDateTime(aprovacao.created_at)}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <MetaField label="Processo" value={aprovacao.numero_processo ?? "—"} mono />
          <MetaField label="CPF" value={<CpfDisplay value={aprovacao.cpf} />} />
          <MetaField
            label="Canal"
            value={formatPhone(aprovacao.telefone_cliente) || "WhatsApp"}
          />
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-[#0b2148]">
            Resumo gerado pela IA
          </h3>
          <div className="rounded-xl border border-[#e2e8f0] bg-[#F8FAFC] p-4 text-sm leading-relaxed text-[#334155] whitespace-pre-wrap">
            {aprovacao.resumo}
          </div>
        </section>

        {baseAnalise.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-[#0b2148]">
              Base da análise
            </h3>
            {contextoLoading ? (
              <p className="text-sm text-[#64748B]">Carregando contexto…</p>
            ) : (
              <ul className="space-y-2">
                {baseAnalise.map((item, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-sm text-[#475569]"
                  >
                    <span
                      className="mt-2 size-1.5 shrink-0 rotate-45 bg-[#0b2148]"
                      aria-hidden
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {isPendente && isAdvogado ? (
          <>
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label
                  htmlFor="msg-enviar"
                  className="text-sm font-semibold text-[#0b2148]"
                >
                  Mensagem que será enviada
                </Label>
                <span className="text-xs tabular-nums text-[#94a3b8]">
                  {texto.length} caracteres
                </span>
              </div>
              <Textarea
                id="msg-enviar"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={8}
                className="border-[#e2e8f0] bg-white text-[#0b2148]"
              />
              {editado && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-[#64748B]"
                  onClick={() => setTexto(aprovacao.resumo)}
                >
                  Restaurar texto original da IA
                </Button>
              )}
            </section>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                disabled={loading || !texto.trim()}
                onClick={() => decidir("aprovar", texto)}
                className="gap-2 bg-[#0b2148] text-white hover:bg-[#163a7a]"
              >
                <Send className="h-4 w-4" />
                {editado ? "Aprovar com edição e enviar" : "Aprovar e enviar"}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger
                  disabled={loading}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "gap-2 border-red-200 text-red-700 hover:bg-red-50"
                  )}
                >
                  <XCircle className="h-4 w-4" />
                  Recusar
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Recusar este resumo</AlertDialogTitle>
                    <AlertDialogDescription>
                      O resumo não será enviado. Registre o motivo (interno) e
                      escolha se o cliente recebe um aviso.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label>Motivo da recusa (interno)</Label>
                      <Textarea
                        value={motivoRecusa}
                        onChange={(e) => setMotivoRecusa(e.target.value)}
                        placeholder="Ex.: resumo com informação incorreta sobre a fase do processo"
                        rows={2}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id={`enviar-msg-recusa-${aprovacao.id}`}
                        type="checkbox"
                        checked={enviarMsgRecusa}
                        onChange={(e) => setEnviarMsgRecusa(e.target.checked)}
                        className="h-4 w-4"
                      />
                      <Label htmlFor={`enviar-msg-recusa-${aprovacao.id}`}>
                        Enviar aviso ao cliente no WhatsApp
                      </Label>
                    </div>
                    {enviarMsgRecusa && (
                      <Textarea
                        value={msgRecusa}
                        onChange={(e) => setMsgRecusa(e.target.value)}
                        rows={3}
                      />
                    )}
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        decidir(
                          "recusar",
                          enviarMsgRecusa ? msgRecusa : undefined,
                          motivoRecusa
                        )
                      }
                    >
                      Confirmar recusa
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {conversaHref ? (
                <Link
                  href={conversaHref}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "gap-2 border-[#0b2148]/25 text-[#0b2148]"
                  )}
                >
                  <MessageSquare className="h-4 w-4" />
                  Abrir conversa
                </Link>
              ) : (
                <Button variant="outline" disabled className="gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Abrir conversa
                </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-[#64748B]"
                onClick={() => setModoResposta((v) => !v)}
              >
                {modoResposta ? "Ocultar resposta manual" : "Responder manualmente"}
              </Button>
            </div>

            {modoResposta && (
              <div className="space-y-2 rounded-xl border border-[#e2e8f0] bg-[#F8FAFC] p-4">
                <Label>Resposta manual ao cliente</Label>
                <Textarea
                  placeholder="Escreva a mensagem que substituirá o resumo da IA…"
                  value={respostaManual}
                  onChange={(e) => setRespostaManual(e.target.value)}
                  rows={4}
                />
                <Button
                  disabled={loading || !respostaManual.trim()}
                  onClick={() => decidir("responder", respostaManual)}
                  className="gap-2 bg-[#0b2148] text-white hover:bg-[#163a7a]"
                >
                  <Send className="h-4 w-4" />
                  Enviar resposta manual
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            {!isPendente && (
              <section className="space-y-3 rounded-xl border border-[#e2e8f0] bg-[#F8FAFC] p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[#0b2148]">Decisão registrada</span>
                  <span className="text-[#64748B]">
                    por {contexto?.decisorNome ?? "—"} em{" "}
                    {formatDateTime(aprovacao.decidido_em)}
                  </span>
                  {aprovacao.enviado_whatsapp && (
                    <Badge variant="outline" className="gap-1">
                      <Send className="h-3 w-3" /> enviado
                    </Badge>
                  )}
                </div>
                {(aprovacao.resumo_final || aprovacao.resposta_manual) && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[#94a3b8]">
                      Texto enviado ao cliente
                    </p>
                    <div className="whitespace-pre-wrap rounded-lg border bg-white p-3 text-[#334155]">
                      {aprovacao.resumo_final ?? aprovacao.resposta_manual}
                    </div>
                  </div>
                )}
                {aprovacao.motivo_recusa && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[#94a3b8]">
                      Motivo da recusa (interno)
                    </p>
                    <p className="text-[#475569]">{aprovacao.motivo_recusa}</p>
                  </div>
                )}
              </section>
            )}
            {isPendente && !isAdvogado && (
              <p className="text-sm text-[#64748B]">
                Apenas advogados podem aprovar, recusar ou responder pendências.
              </p>
            )}
            {conversaHref && (
              <Link
                href={conversaHref}
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "gap-2 border-[#0b2148]/25 text-[#0b2148]"
                )}
              >
                <MessageSquare className="h-4 w-4" />
                Abrir conversa
              </Link>
            )}
          </>
        )}

        <ContextoLinks aprovacao={aprovacao} contexto={contexto} />
      </CardContent>
    </Card>
  );
}

function MetaField({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-[#F8FAFC] px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">
        {label}
      </p>
      <div
        className={cn(
          "mt-0.5 text-sm font-medium text-[#0b2148]",
          mono && "font-mono text-xs"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ContextoLinks({
  aprovacao,
  contexto,
}: {
  aprovacao: Aprovacao;
  contexto: AprovacaoContexto | null;
}) {
  if (!contexto) return null;
  const hasLinks =
    contexto.cpf ||
    contexto.contactNorm ||
    contexto.casoFunil ||
    contexto.anteriores.length > 0 ||
    contexto.mensagens.length > 0;
  if (!hasLinks) return null;

  return (
    <section className="space-y-3 border-t border-[#e2e8f0] pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">
        Contexto
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {contexto.cpf && (
          <Link
            href={fichaPessoaHref({ cpf: contexto.cpf })}
            className="inline-flex items-center gap-1.5 text-[#0b2148] hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Ficha do cliente
          </Link>
        )}
        {contexto.casoFunil && (
          <Link
            href={fichaPessoaHref({
              cpf: contexto.cpf,
              contactNorm: contexto.contactNorm,
              aba: "caso",
              casoId: contexto.casoFunil.id,
            })}
            className="inline-flex items-center gap-1.5 text-[#0b2148] hover:underline"
          >
            <Kanban className="h-3.5 w-3.5" /> Funil (
            {CASO_STATUS.find((s) => s.value === contexto.casoFunil?.status)
              ?.label ?? contexto.casoFunil.status}
            )
          </Link>
        )}
        {contexto.processos.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[#64748B]">
            <FileText className="h-3.5 w-3.5" />
            {contexto.processos.length} processo(s) na base
          </span>
        )}
      </div>

      {contexto.mensagens.length > 0 && (
        <div className="space-y-2 rounded-xl border border-[#e2e8f0] p-3">
          <p className="text-xs font-medium text-[#64748B]">Últimas mensagens</p>
          {contexto.mensagens.slice(-3).map((m) => (
            <div
              key={m.id}
              className={cn(
                "max-w-[90%] rounded-lg px-2.5 py-1.5 text-xs",
                m.type === "user"
                  ? "bg-[#F1F5F9] text-[#334155]"
                  : "ml-auto bg-[#0b2148]/8 text-right text-[#0b2148]"
              )}
            >
              <p className="line-clamp-2 whitespace-pre-wrap">
                {m.text || "(mídia)"}
              </p>
              <p className="mt-0.5 text-[10px] text-[#94a3b8]">
                {formatChatTime(m.created_at)}
              </p>
            </div>
          ))}
        </div>
      )}

      {contexto.anteriores.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {contexto.anteriores.map((a) => (
            <Link
              key={a.id}
              href={`/aprovacoes/${a.id}`}
              className="rounded-md border border-[#e2e8f0] px-2 py-1 text-xs text-[#64748B] hover:bg-[#F8FAFC]"
            >
              {formatDateTime(a.created_at)} · {statusLabel(a.status)}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
