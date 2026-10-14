"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileDown,
  ListFilter,
  Search,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  NovoPrazoDialog,
  PrazoPopoverItem,
  PrazoRowFull,
  diasAtePrazo,
  inputShell,
  prazoChipClasses,
  tipoLabel,
  usePrazoAcoes,
  type PrazoEnriched,
  type PrazoParceiroOption,
  type PrazoProcessoOption,
} from "@/components/prazos/prazos-ui";
import { PRAZO_TIPOS } from "@/lib/utils/beneficios";
import {
  PRAZO_SITUACOES,
  filtrarPrazos,
  ordenarPrazos,
  relatorioPrazosHref,
  situacaoLabel,
  type PrazoSituacao,
} from "@/lib/prazos/filtro";
import { horaPrazoForInput } from "@/lib/prazos/lembretes";
import {
  DIAS_SEMANA_CURTOS,
  PRAZO_VISOES,
  diaDoMes,
  deslocarRef,
  diasDaVisao,
  formatDiaLongo,
  formatDiaMesCurto,
  formatDiaSemanaCurto,
  isIsoDate,
  isPrazoVisao,
  mesmoMes,
  tituloPeriodo,
  type PrazoVisao,
} from "@/lib/prazos/calendario";
import { formatNumeroProcesso } from "@/lib/utils/processo";
import { formatValorCentavos } from "@/lib/utils/processos";
import type { PrazoTipo } from "@/types/database";
import { cn } from "@/lib/utils";

const TODOS = "todos";
const MAX_CHIPS_MES = 3;

/* ---------- helpers ---------- */

const MOBILE_QUERY = "(max-width: 639px)";

function subscribeMobile(cb: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

/** false no SSR/hidratação; valor real depois (sem mismatch). */
function useIsMobile() {
  return useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false
  );
}

function sortPorHora(a: PrazoEnriched, b: PrazoEnriched) {
  const ha = horaPrazoForInput(a.hora_prazo) || "99:99";
  const hb = horaPrazoForInput(b.hora_prazo) || "99:99";
  return ha.localeCompare(hb) || a.titulo.localeCompare(b.titulo);
}

function horaCurta(p: PrazoEnriched) {
  return horaPrazoForInput(p.hora_prazo) || null;
}

function dotClass(p: PrazoEnriched, todayIso: string) {
  if (p.concluido) return "bg-slate-300";
  const dias = diasAtePrazo(p.data_prazo, todayIso);
  if (dias < 0) return "bg-red-500";
  if (dias === 0) return "bg-amber-500";
  return "bg-[#0b2148]";
}

type Acoes = ReturnType<typeof usePrazoAcoes>;

/* ---------- KPIs ---------- */

function KpiCard({
  dotClass,
  label,
  value,
  sub,
  onClick,
  ativo = false,
}: {
  dotClass: string;
  label: string;
  value: number | string;
  sub: string;
  /** Clicar no card aplica o filtro de situação correspondente. */
  onClick?: () => void;
  ativo?: boolean;
}) {
  const card = (
    <Card
      className={cn(
        "h-full border-[#e2e8f0] bg-white shadow-sm transition-colors",
        onClick && "hover:border-[#0b2148]/30",
        ativo && "border-[#0b2148] ring-2 ring-[#0b2148]/12"
      )}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dotClass)} />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">
              {label}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-[#0b2148]">
              {value}
            </p>
            <p className="mt-0.5 text-xs text-[#94a3b8]">{sub}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
  if (!onClick) return card;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className="rounded-xl text-left focus-visible:ring-2 focus-visible:ring-[#0b2148]/30 focus-visible:outline-none"
    >
      {card}
    </button>
  );
}

/* ---------- Página /prazos, /audiencias e /pagamentos ---------- */

type ModoPagina = "prazos" | "audiencias" | "pagamentos";

const TEXTOS: Record<
  ModoPagina,
  {
    titulo: string;
    fixedTipo?: PrazoTipo;
    vazioDia: string;
    nenhumNoDia: string;
    noFiltro: string;
    mostrarConcluidos: string;
  }
> = {
  prazos: {
    titulo: "Prazos",
    vazioDia: "Sem prazos",
    nenhumNoDia: "Nenhum prazo neste dia.",
    noFiltro: "prazos no filtro",
    mostrarConcluidos: "Mostrar concluídos",
  },
  audiencias: {
    titulo: "Audiências",
    fixedTipo: "audiencia",
    vazioDia: "Sem audiências",
    nenhumNoDia: "Nenhuma audiência neste dia.",
    noFiltro: "audiências no filtro",
    mostrarConcluidos: "Mostrar histórico",
  },
  pagamentos: {
    titulo: "Pagamentos",
    fixedTipo: "pagamento",
    vazioDia: "Sem pagamentos",
    nenhumNoDia: "Nenhum pagamento neste dia.",
    noFiltro: "pagamentos no filtro",
    mostrarConcluidos: "Mostrar pagos",
  },
};

export function PrazosPageContent({
  prazos,
  mode = "prazos",
  processos,
  parceiros = [],
  todayIso,
}: {
  prazos: PrazoEnriched[];
  /** "audiencias" / "pagamentos": textos próprios e "Novo …" com tipo fixo. */
  mode?: ModoPagina;
  /** Opções do seletor de processo nos diálogos. */
  processos?: PrazoProcessoOption[];
  parceiros?: PrazoParceiroOption[];
  /** Dia civil em Brasília calculado no servidor (yyyy-MM-dd). */
  todayIso: string;
}) {
  const isAudiencias = mode === "audiencias";
  const isPagamentos = mode === "pagamentos";
  const textos = TEXTOS[mode];
  const acoes = usePrazoAcoes({ audiencia: isAudiencias, pagamento: isPagamentos });
  const [busca, setBusca] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState<string>(TODOS);
  const [processoFiltro, setProcessoFiltro] = useState<string>(TODOS);
  const [parceiroFiltro, setParceiroFiltro] = useState<string>(TODOS);
  const [mostrarConcluidos, setMostrarConcluidos] = useState(false);
  const [situacao, setSituacao] = useState<PrazoSituacao>("todos");
  const alternarSituacao = (s: PrazoSituacao) =>
    setSituacao((atual) => (atual === s ? "todos" : s));

  const kpis = useMemo(() => {
    let atrasados = 0;
    let hoje = 0;
    let prox7 = 0;
    let concluidos = 0;
    for (const p of prazos) {
      if (p.concluido) {
        concluidos++;
        continue;
      }
      const dias = diasAtePrazo(p.data_prazo, todayIso);
      if (dias < 0) atrasados++;
      else if (dias === 0) hoje++;
      else if (dias <= 7) prox7++;
    }
    return { atrasados, hoje, prox7, concluidos };
  }, [prazos, todayIso]);

  const totaisPagamento = useMemo(() => {
    let pendente = 0;
    let pago = 0;
    for (const p of prazos) {
      if (p.concluido) pago += p.valor_centavos ?? 0;
      else pendente += p.valor_centavos ?? 0;
    }
    return { pendente, pago };
  }, [prazos]);

  const processoFiltroOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of prazos) {
      if (p.processo_id == null || map.has(p.processo_id)) continue;
      const numero = p.numero_processo
        ? formatNumeroProcesso(p.numero_processo)
        : `Processo #${p.processo_id}`;
      map.set(
        p.processo_id,
        p.cliente_nome ? `${numero} · ${p.cliente_nome}` : numero
      );
    }
    return [...map.entries()]
      .map(([id, label]) => ({ id: String(id), label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [prazos]);

  const filtrosAtivos =
    busca.trim() !== "" ||
    situacao !== "todos" ||
    tipoFiltro !== TODOS ||
    processoFiltro !== TODOS ||
    parceiroFiltro !== TODOS;

  function limparFiltros() {
    setBusca("");
    setSituacao("todos");
    setTipoFiltro(TODOS);
    setProcessoFiltro(TODOS);
    setParceiroFiltro(TODOS);
  }

  const filtrosBase = useMemo(
    () => ({
      busca,
      tipo: tipoFiltro !== TODOS ? tipoFiltro : null,
      processoId: processoFiltro !== TODOS ? Number(processoFiltro) : null,
      parceiroId: parceiroFiltro !== TODOS ? parceiroFiltro : null,
    }),
    [busca, tipoFiltro, processoFiltro, parceiroFiltro]
  );

  const filtradosSemStatus = useMemo(
    () => filtrarPrazos(prazos, filtrosBase, todayIso),
    [prazos, filtrosBase, todayIso]
  );

  /** Situação escolhida: lista em vez de calendário (atrasados ficam em meses passados). */
  const listaSituacao = useMemo(
    () =>
      situacao === "todos"
        ? []
        : ordenarPrazos(
            filtrarPrazos(prazos, { ...filtrosBase, situacao }, todayIso),
            situacao
          ),
    [prazos, filtrosBase, situacao, todayIso]
  );

  // O PDF traz o que a tela mostra: a situação escolhida ou, no calendário, abertos/todos.
  const situacaoRelatorio: PrazoSituacao =
    situacao !== "todos" ? situacao : mostrarConcluidos ? "todos" : "abertos";
  const abrirRelatorio = () =>
    window.open(
      relatorioPrazosHref({ modo: mode, ...filtrosBase, situacao: situacaoRelatorio }),
      "_blank",
      "noopener"
    );

  const visiveis = useMemo(
    () =>
      mostrarConcluidos
        ? filtradosSemStatus
        : filtradosSemStatus.filter((p) => !p.concluido),
    [filtradosSemStatus, mostrarConcluidos]
  );

  const atrasados = useMemo(
    () =>
      filtradosSemStatus
        .filter(
          (p) => !p.concluido && diasAtePrazo(p.data_prazo, todayIso) < 0
        )
        .sort(
          (a, b) => a.data_prazo.localeCompare(b.data_prazo) || sortPorHora(a, b)
        ),
    [filtradosSemStatus, todayIso]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0b2148]">
            {textos.titulo}
          </h1>
          <p className="mt-1 text-sm text-[#64748B]">
            {formatDiaLongo(todayIso)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-1.5 border-[#e2e8f0] text-[#0b2148]"
            onClick={abrirRelatorio}
            disabled={prazos.length === 0}
          >
            <FileDown className="size-4" />
            Relatório PDF
          </Button>
          <NovoPrazoDialog
            fixedTipo={textos.fixedTipo}
            processos={processos}
            triggerClassName="shadow-[0_8px_24px_rgba(11,33,72,0.18)]"
          />
        </div>
      </div>

      {isPagamentos ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard
            dotClass="bg-red-500"
            label="Atrasados"
            value={kpis.atrasados}
            sub="Data passou e não foi pago"
            onClick={() => alternarSituacao("atrasados")}
            ativo={situacao === "atrasados"}
          />
          <KpiCard
            dotClass="bg-amber-500"
            label="Hoje"
            value={kpis.hoje}
            sub="Pagamentos previstos para hoje"
            onClick={() => alternarSituacao("hoje")}
            ativo={situacao === "hoje"}
          />
          <KpiCard
            dotClass="bg-[#0b2148]"
            label="Em aberto"
            value={formatValorCentavos(totaisPagamento.pendente)}
            sub={`${kpis.prox7} nos próximos 7 dias`}
            onClick={() => alternarSituacao("abertos")}
            ativo={situacao === "abertos"}
          />
          <KpiCard
            dotClass="bg-emerald-500"
            label="Pagos"
            value={formatValorCentavos(totaisPagamento.pago)}
            sub={`${kpis.concluidos} pagamento(s) marcado(s) como pago`}
            onClick={() => alternarSituacao("concluidos")}
            ativo={situacao === "concluidos"}
          />
        </div>
      ) : isAudiencias ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard
            dotClass="bg-amber-500"
            label="Hoje"
            value={kpis.hoje}
            sub="Audiências marcadas para hoje"
            onClick={() => alternarSituacao("hoje")}
            ativo={situacao === "hoje"}
          />
          <KpiCard
            dotClass="bg-[#0b2148]"
            label="Esta semana"
            value={kpis.prox7}
            sub="Nos próximos 7 dias"
            onClick={() => alternarSituacao("proximos_7")}
            ativo={situacao === "proximos_7"}
          />
          <KpiCard
            dotClass="bg-red-500"
            label="Passadas em aberto"
            value={kpis.atrasados}
            sub="Já ocorreram e não foram concluídas"
            onClick={() => alternarSituacao("atrasados")}
            ativo={situacao === "atrasados"}
          />
          <KpiCard
            dotClass="bg-slate-400"
            label="Histórico"
            value={kpis.concluidos}
            sub="Audiências concluídas"
            onClick={() => alternarSituacao("concluidos")}
            ativo={situacao === "concluidos"}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard
            dotClass="bg-red-500"
            label="Atrasados"
            value={kpis.atrasados}
            sub="Precisam de ação imediata"
            onClick={() => alternarSituacao("atrasados")}
            ativo={situacao === "atrasados"}
          />
          <KpiCard
            dotClass="bg-amber-500"
            label="Vencem hoje"
            value={kpis.hoje}
            sub="Data limite é hoje"
            onClick={() => alternarSituacao("hoje")}
            ativo={situacao === "hoje"}
          />
          <KpiCard
            dotClass="bg-[#0b2148]"
            label="Próximos 7 dias"
            value={kpis.prox7}
            sub="Na semana que vem"
            onClick={() => alternarSituacao("proximos_7")}
            ativo={situacao === "proximos_7"}
          />
          <KpiCard
            dotClass="bg-slate-400"
            label="Concluídos"
            value={kpis.concluidos}
            sub="Encerrados no sistema"
            onClick={() => alternarSituacao("concluidos")}
            ativo={situacao === "concluidos"}
          />
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-[#e2e8f0] bg-white p-3 shadow-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
          <div className="relative min-w-0 sm:col-span-2 lg:min-w-[240px] lg:flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#94a3b8]" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={
                isAudiencias
                  ? "Cliente (nome ou CPF), audiência, local..."
                  : isPagamentos
                    ? "Cliente (nome ou CPF), pagamento, processo..."
                    : "Cliente (nome ou CPF), prazo, processo..."
              }
              aria-label="Buscar por cliente"
              className={cn(inputShell, "h-10 pl-9")}
            />
          </div>
          <Select
            value={situacao}
            onValueChange={(v) =>
              setSituacao(
                PRAZO_SITUACOES.includes(v as PrazoSituacao)
                  ? (v as PrazoSituacao)
                  : "todos"
              )
            }
          >
            <SelectTrigger
              className={cn(
                inputShell,
                "h-10 w-full lg:w-[220px]",
                situacao === "atrasados" && "border-red-300 text-red-700"
              )}
              aria-label="Filtrar por situação"
            >
              <ListFilter className="size-4 text-[#94a3b8]" />
              <SelectValue>
                {(v) => situacaoLabel((v as PrazoSituacao) || "todos", mode)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PRAZO_SITUACOES.map((s) => (
                <SelectItem key={s} value={s}>
                  {situacaoLabel(s, mode)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={processoFiltro}
            onValueChange={(v) => setProcessoFiltro(v ? String(v) : TODOS)}
          >
            <SelectTrigger
              className={cn(inputShell, "h-10 w-full lg:w-[260px]")}
              aria-label="Filtrar por processo"
            >
              <SelectValue>
                {(v) =>
                  !v || v === TODOS
                    ? "Todos os processos"
                    : (processoFiltroOptions.find((o) => o.id === v)?.label ??
                      "Processo")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os processos</SelectItem>
              {processoFiltroOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {parceiros.length > 0 && (
            <Select
              value={parceiroFiltro}
              onValueChange={(v) => setParceiroFiltro(v ? String(v) : TODOS)}
            >
              <SelectTrigger
                className={cn(inputShell, "h-10 w-full lg:w-[200px]")}
                aria-label="Filtrar por parceiro"
              >
                <SelectValue>
                  {(v) =>
                    !v || v === TODOS
                      ? "Todos os parceiros"
                      : (parceiros.find((p) => p.id === v)?.nome ?? "Parceiro")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os parceiros</SelectItem>
                {parceiros.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {mode === "prazos" && (
            <Select
              value={tipoFiltro}
              onValueChange={(v) => setTipoFiltro(v ? String(v) : TODOS)}
            >
              <SelectTrigger
                className={cn(inputShell, "h-10 w-full lg:w-[180px]")}
                aria-label="Filtrar por tipo"
              >
                <SelectValue>
                  {(v) =>
                    !v || v === TODOS ? "Todos os tipos" : tipoLabel(String(v))
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os tipos</SelectItem>
                {PRAZO_TIPOS.filter((t) => t.value !== "pagamento").map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {filtrosAtivos && (
            <Button
              type="button"
              variant="ghost"
              className="h-10 text-[#64748B] hover:text-[#0b2148]"
              onClick={limparFiltros}
            >
              <X />
              Limpar
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-[#e2e8f0] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[#64748B]">
              <Switch
                checked={mostrarConcluidos}
                onCheckedChange={setMostrarConcluidos}
                disabled={situacao !== "todos"}
                className="data-checked:bg-[#0b2148]"
              />
              {textos.mostrarConcluidos} (
              {kpis.concluidos})
            </label>
            <span className="text-xs text-[#94a3b8]">
              {isPagamentos
                ? "Pagamentos pagos ficam guardados como histórico."
                : "Concluídos são apagados automaticamente após 30 dias."}
            </span>
          </div>
          <p className="text-sm text-[#64748B]">
            <span className="font-semibold text-[#0b2148]">
              {situacao !== "todos" ? listaSituacao.length : visiveis.length}
            </span>{" "}
            {textos.noFiltro}
          </p>
        </div>
      </div>

      {prazos.length === 0 ? (
        isPagamentos ? (
          <EmptyState
            icon={CalendarClock}
            title="Nenhum pagamento cadastrado"
            description="Cadastre RPVs, alvarás, honorários e outros pagamentos com data, valor e lembrete por push."
          />
        ) : isAudiencias ? (
          <EmptyState
            icon={CalendarClock}
            title="Nenhuma audiência cadastrada"
            description="Cadastre audiências com data, local ou link e receba lembretes por push."
          />
        ) : (
          <EmptyState
            icon={CalendarClock}
            title="Nenhum prazo cadastrado"
            description="Crie prazos de exigência do INSS, recurso, perícia ou audiência para não perder datas."
          />
        )
      ) : (
        situacao !== "todos" ? (
          <ListaSituacao
            prazos={listaSituacao}
            titulo={situacaoLabel(situacao, mode)}
            modo={mode}
            acoes={acoes}
            processos={processos}
            todayIso={todayIso}
            onVerCalendario={() => setSituacao("todos")}
          />
        ) : (
        <>
          <FaixaAtrasados
            atrasados={atrasados}
            modo={mode}
            acoes={acoes}
            processos={processos}
            todayIso={todayIso}
          />
          <PrazosCalendario
            prazos={visiveis}
            todayIso={todayIso}
            modo={mode}
            acoes={acoes}
            processos={processos}
          />
        </>
        )
      )}
    </div>
  );
}

/* ---------- Lista filtrada por situação ---------- */

function ListaSituacao({
  prazos,
  titulo,
  modo,
  acoes,
  processos,
  todayIso,
  onVerCalendario,
}: {
  prazos: PrazoEnriched[];
  titulo: string;
  modo: ModoPagina;
  acoes: Acoes;
  processos?: PrazoProcessoOption[];
  todayIso: string;
  onVerCalendario: () => void;
}) {
  const valorTotal =
    modo === "pagamentos"
      ? prazos.reduce((s, p) => s + (p.valor_centavos ?? 0), 0)
      : 0;
  return (
    <section className="rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#e2e8f0] px-3 py-2.5">
        <h2 className="text-sm font-bold text-[#0b2148] sm:text-base">{titulo}</h2>
        <span className="text-sm text-[#64748B]">
          · {prazos.length}
          {valorTotal > 0 && ` · ${formatValorCentavos(valorTotal)}`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto text-[#64748B] hover:text-[#0b2148]"
          onClick={onVerCalendario}
        >
          <CalendarClock />
          Ver calendário
        </Button>
      </div>
      {prazos.length === 0 ? (
        <p className="p-6 text-center text-sm text-[#64748B]">
          Nada nesta situação com os filtros atuais.
        </p>
      ) : (
        <ul className="space-y-2 p-3">
          {prazos.map((p) => (
            <PrazoRowFull
              key={p.id}
              prazo={p}
              onToggle={acoes.toggle}
              onRemove={acoes.remover}
              processos={processos}
              todayIso={todayIso}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Faixa de atrasados ---------- */

function FaixaAtrasados({
  atrasados,
  modo,
  acoes,
  processos,
  todayIso,
}: {
  atrasados: PrazoEnriched[];
  modo: ModoPagina;
  acoes: Acoes;
  processos?: PrazoProcessoOption[];
  todayIso: string;
}) {
  const [aberta, setAberta] = useState(true);
  if (!atrasados.length) return null;
  const n = atrasados.length;
  const titulo = modo === "audiencias"
    ? `${n} ${n === 1 ? "audiência passada" : "audiências passadas"} sem conclusão`
    : `${n} ${n === 1 ? "atrasado" : "atrasados"}`;

  return (
    <section className="rounded-xl border border-red-200 bg-red-50/40">
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <AlertTriangle className="size-4 shrink-0 text-red-600" />
        <span className="text-sm font-bold text-red-800">{titulo}</span>
        <ChevronDown
          className={cn(
            "ml-auto size-4 text-red-700 transition-transform",
            aberta && "rotate-180"
          )}
        />
      </button>
      {aberta && (
        <ul className="max-h-[420px] space-y-2 overflow-y-auto px-3 pb-3">
          {atrasados.map((p) => (
            <PrazoRowFull
              key={p.id}
              prazo={p}
              onToggle={acoes.toggle}
              onRemove={acoes.remover}
              processos={processos}
              todayIso={todayIso}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Calendário ---------- */

function PrazosCalendario({
  prazos,
  todayIso,
  modo,
  acoes,
  processos,
}: {
  prazos: PrazoEnriched[];
  todayIso: string;
  modo: ModoPagina;
  acoes: Acoes;
  processos?: PrazoProcessoOption[];
}) {
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const visaoParam = searchParams.get("visao");
  const dataParam = searchParams.get("data");
  const visao: PrazoVisao = isPrazoVisao(visaoParam)
    ? visaoParam
    : isMobile
      ? "dia"
      : "semana";
  const refIso = isIsoDate(dataParam) ? dataParam : todayIso;

  // history.replaceState é integrado ao useSearchParams e não refaz o fetch do servidor.
  const navegar = useCallback(
    (next: { visao?: PrazoVisao; data?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("visao", next.visao ?? visao);
      params.set("data", next.data ?? refIso);
      window.history.replaceState(null, "", `?${params.toString()}`);
    },
    [searchParams, visao, refIso]
  );

  const porDia = useMemo(() => {
    const map = new Map<string, PrazoEnriched[]>();
    for (const p of prazos) {
      const list = map.get(p.data_prazo) ?? [];
      list.push(p);
      map.set(p.data_prazo, list);
    }
    for (const list of map.values()) list.sort(sortPorHora);
    return map;
  }, [prazos]);

  const dias = useMemo(() => diasDaVisao(visao, refIso), [visao, refIso]);
  const abrirDia = (iso: string) => navegar({ visao: "dia", data: iso });

  return (
    <section className="rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-[#e2e8f0] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="border-[#e2e8f0] text-[#0b2148]"
            onClick={() => navegar({ data: deslocarRef(visao, refIso, -1) })}
            aria-label="Período anterior"
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-[#e2e8f0] text-[#0b2148]"
            onClick={() => navegar({ data: todayIso })}
            disabled={refIso === todayIso}
          >
            Hoje
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="border-[#e2e8f0] text-[#0b2148]"
            onClick={() => navegar({ data: deslocarRef(visao, refIso, 1) })}
            aria-label="Próximo período"
          >
            <ChevronRight />
          </Button>
          <h2 className="ml-1.5 min-w-0 truncate text-sm font-bold text-[#0b2148] sm:text-base">
            {tituloPeriodo(visao, refIso)}
          </h2>
        </div>
        <div
          role="tablist"
          aria-label="Visão do calendário"
          className="inline-flex self-start rounded-lg border border-[#e2e8f0] bg-[#F8FAFC] p-0.5 sm:self-auto"
        >
          {PRAZO_VISOES.map((v) => (
            <button
              key={v.value}
              type="button"
              role="tab"
              aria-selected={visao === v.value}
              onClick={() => navegar({ visao: v.value })}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium text-[#64748B] transition-colors",
                visao === v.value
                  ? "bg-white text-[#0b2148] shadow-sm"
                  : "hover:text-[#0b2148]"
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {visao === "mes" && (
        <VisaoMes
          dias={dias}
          refIso={refIso}
          todayIso={todayIso}
          porDia={porDia}
          acoes={acoes}
          processos={processos}
          onAbrirDia={abrirDia}
        />
      )}
      {visao === "semana" && (
        <VisaoSemana
          dias={dias}
          todayIso={todayIso}
          porDia={porDia}
          acoes={acoes}
          processos={processos}
          onAbrirDia={abrirDia}
          modo={modo}
        />
      )}
      {visao === "dia" && (
        <VisaoDia
          dia={refIso}
          todayIso={todayIso}
          itens={porDia.get(refIso) ?? []}
          acoes={acoes}
          processos={processos}
          modo={modo}
        />
      )}
    </section>
  );
}

function PrazoChip({
  prazo,
  todayIso,
  acoes,
  processos,
  multiline = false,
}: {
  prazo: PrazoEnriched;
  todayIso: string;
  acoes: Acoes;
  processos?: PrazoProcessoOption[];
  multiline?: boolean;
}) {
  const hora = horaCurta(prazo);
  return (
    <PrazoPopoverItem
      prazo={prazo}
      todayIso={todayIso}
      onToggle={acoes.toggle}
      onRemove={acoes.remover}
      processos={processos}
      className={cn(
        "block w-full rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight transition-shadow hover:shadow-sm focus-visible:ring-2 focus-visible:ring-[#0b2148]/30 focus-visible:outline-none",
        prazoChipClasses(prazo, todayIso)
      )}
    >
      {multiline ? (
        <>
          <span className="flex items-center gap-1 font-semibold tabular-nums">
            {hora ?? "Dia todo"}
          </span>
          <span className="mt-0.5 line-clamp-2 font-medium">{prazo.titulo}</span>
          {prazo.cliente_nome && (
            <span className="mt-0.5 block truncate opacity-75">
              {prazo.cliente_nome}
            </span>
          )}
        </>
      ) : (
        <span className="block truncate">
          {hora && <span className="font-semibold tabular-nums">{hora} </span>}
          {prazo.titulo}
        </span>
      )}
    </PrazoPopoverItem>
  );
}

function VisaoMes({
  dias,
  refIso,
  todayIso,
  porDia,
  acoes,
  processos,
  onAbrirDia,
}: {
  dias: string[];
  refIso: string;
  todayIso: string;
  porDia: Map<string, PrazoEnriched[]>;
  acoes: Acoes;
  processos?: PrazoProcessoOption[];
  onAbrirDia: (iso: string) => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-[#e2e8f0] bg-[#F8FAFC]">
        {DIAS_SEMANA_CURTOS.map((d) => (
          <div
            key={d}
            className="px-1 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-[#64748B]"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dias.map((iso, i) => {
          const itens = porDia.get(iso) ?? [];
          const foraDoMes = !mesmoMes(iso, refIso);
          const hoje = iso === todayIso;
          const extra = itens.length - MAX_CHIPS_MES;
          return (
            <div
              key={iso}
              className={cn(
                "flex min-h-16 min-w-0 flex-col gap-1 border-[#e2e8f0] p-1 sm:min-h-28 sm:p-1.5",
                i % 7 !== 6 && "border-r",
                i < dias.length - 7 && "border-b",
                foraDoMes && "bg-[#F8FAFC]/70"
              )}
            >
              <button
                type="button"
                onClick={() => onAbrirDia(iso)}
                aria-label={`Ver ${formatDiaLongo(iso)}`}
                className={cn(
                  "flex size-6 items-center justify-center self-center rounded-full text-xs font-semibold transition-colors hover:bg-[#0b2148]/10 sm:self-start",
                  foraDoMes ? "text-[#94a3b8]" : "text-[#0b2148]",
                  hoje && "bg-[#0b2148] text-white hover:bg-[#163a7a]"
                )}
              >
                {diaDoMes(iso)}
              </button>
              {itens.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => onAbrirDia(iso)}
                    className="flex flex-wrap items-center justify-center gap-0.5 sm:hidden"
                    aria-label={`${itens.length} em ${formatDiaLongo(iso)}`}
                  >
                    {itens.slice(0, MAX_CHIPS_MES).map((p) => (
                      <span
                        key={p.id}
                        className={cn(
                          "size-1.5 rounded-full",
                          dotClass(p, todayIso)
                        )}
                      />
                    ))}
                    {extra > 0 && (
                      <span className="text-[10px] font-semibold text-[#64748B]">
                        +{extra}
                      </span>
                    )}
                  </button>
                  <div className="hidden min-w-0 flex-col gap-1 sm:flex">
                    {itens.slice(0, MAX_CHIPS_MES).map((p) => (
                      <PrazoChip
                        key={p.id}
                        prazo={p}
                        todayIso={todayIso}
                        acoes={acoes}
                        processos={processos}
                      />
                    ))}
                    {extra > 0 && (
                      <button
                        type="button"
                        onClick={() => onAbrirDia(iso)}
                        className="self-start rounded px-1 text-[11px] font-semibold text-[#64748B] hover:bg-[#0b2148]/5 hover:text-[#0b2148]"
                      >
                        +{extra}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VisaoSemana({
  dias,
  todayIso,
  porDia,
  acoes,
  processos,
  onAbrirDia,
  modo,
}: {
  dias: string[];
  todayIso: string;
  porDia: Map<string, PrazoEnriched[]>;
  acoes: Acoes;
  processos?: PrazoProcessoOption[];
  onAbrirDia: (iso: string) => void;
  modo: ModoPagina;
}) {
  return (
    <div className="grid grid-cols-1 divide-y divide-[#e2e8f0] lg:grid-cols-7 lg:divide-x lg:divide-y-0">
      {dias.map((iso) => {
        const itens = porDia.get(iso) ?? [];
        const hoje = iso === todayIso;
        return (
          <div key={iso} className="flex min-w-0 flex-col gap-1.5 p-2 lg:min-h-64">
            <button
              type="button"
              onClick={() => onAbrirDia(iso)}
              className={cn(
                "flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[#0b2148]/5 lg:flex-col lg:items-start lg:gap-0",
                hoje && "bg-[#0b2148]/8"
              )}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
                {formatDiaSemanaCurto(iso)}
              </span>
              <span
                className={cn(
                  "text-sm font-bold text-[#0b2148] lg:text-lg",
                  hoje && "text-[#0b2148]"
                )}
              >
                <span className="lg:hidden">{formatDiaMesCurto(iso)}</span>
                <span className="hidden lg:inline">{diaDoMes(iso)}</span>
              </span>
              {hoje && (
                <span className="rounded-full bg-[#0b2148] px-1.5 py-0.5 text-[10px] font-semibold text-white lg:mt-0.5">
                  Hoje
                </span>
              )}
              {itens.length > 0 && (
                <span className="ml-auto rounded-full bg-[#F1F5F9] px-1.5 text-[11px] font-semibold text-[#64748B] lg:hidden">
                  {itens.length}
                </span>
              )}
            </button>
            {itens.length === 0 ? (
              <p className="px-1.5 text-xs text-[#cbd5e1] lg:hidden">
                {TEXTOS[modo].vazioDia}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
                {itens.map((p) => (
                  <PrazoChip
                    key={p.id}
                    prazo={p}
                    todayIso={todayIso}
                    acoes={acoes}
                    processos={processos}
                    multiline
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function VisaoDia({
  dia,
  todayIso,
  itens,
  acoes,
  processos,
  modo,
}: {
  dia: string;
  todayIso: string;
  itens: PrazoEnriched[];
  acoes: Acoes;
  processos?: PrazoProcessoOption[];
  modo: ModoPagina;
}) {
  if (!itens.length) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-[#64748B]">
        <p>
          {TEXTOS[modo].nenhumNoDia}
        </p>
        <NovoPrazoDialog
          fixedTipo={TEXTOS[modo].fixedTipo}
          processos={processos}
          defaultDataIso={dia}
          triggerVariant="outline"
          triggerClassName="border border-[#0b2148]/25"
        />
      </div>
    );
  }
  return (
    <ul className="space-y-2 p-3">
      {itens.map((p) => (
        <PrazoRowFull
          key={p.id}
          prazo={p}
          onToggle={acoes.toggle}
          onRemove={acoes.remover}
          processos={processos}
          todayIso={todayIso}
        />
      ))}
    </ul>
  );
}
