"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
  matchesBusca,
  prazoChipClasses,
  tipoLabel,
  usePrazoAcoes,
  type PrazoEnriched,
  type PrazoParceiroOption,
  type PrazoProcessoOption,
} from "@/components/prazos/prazos-ui";
import { PRAZO_TIPOS } from "@/lib/utils/beneficios";
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
}: {
  dotClass: string;
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <Card className="border-[#e2e8f0] bg-white shadow-sm">
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
}

/* ---------- Página /prazos e /audiencias ---------- */

export function PrazosPageContent({
  prazos,
  mode = "prazos",
  processos,
  parceiros = [],
  todayIso,
}: {
  prazos: PrazoEnriched[];
  /** "audiencias": textos de audiência e "Nova audiência" com tipo fixo. */
  mode?: "prazos" | "audiencias";
  /** Opções do seletor de processo nos diálogos. */
  processos?: PrazoProcessoOption[];
  parceiros?: PrazoParceiroOption[];
  /** Dia civil em Brasília calculado no servidor (yyyy-MM-dd). */
  todayIso: string;
}) {
  const isAudiencias = mode === "audiencias";
  const acoes = usePrazoAcoes({ audiencia: isAudiencias });
  const [busca, setBusca] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState<string>(TODOS);
  const [processoFiltro, setProcessoFiltro] = useState<string>(TODOS);
  const [parceiroFiltro, setParceiroFiltro] = useState<string>(TODOS);
  const [mostrarConcluidos, setMostrarConcluidos] = useState(false);

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
    tipoFiltro !== TODOS ||
    processoFiltro !== TODOS ||
    parceiroFiltro !== TODOS;

  function limparFiltros() {
    setBusca("");
    setTipoFiltro(TODOS);
    setProcessoFiltro(TODOS);
    setParceiroFiltro(TODOS);
  }

  const filtradosSemStatus = useMemo(() => {
    return prazos.filter((p) => {
      if (tipoFiltro !== TODOS && p.tipo !== tipoFiltro) return false;
      if (processoFiltro !== TODOS && String(p.processo_id) !== processoFiltro)
        return false;
      if (parceiroFiltro !== TODOS && p.parceiro_id !== parceiroFiltro)
        return false;
      return matchesBusca(p, busca);
    });
  }, [prazos, busca, tipoFiltro, processoFiltro, parceiroFiltro]);

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
            {isAudiencias ? "Audiências" : "Prazos"}
          </h1>
          <p className="mt-1 text-sm text-[#64748B]">
            {formatDiaLongo(todayIso)}
          </p>
        </div>
        <NovoPrazoDialog
          fixedTipo={isAudiencias ? "audiencia" : undefined}
          processos={processos}
          triggerClassName="shadow-[0_8px_24px_rgba(11,33,72,0.18)]"
        />
      </div>

      {isAudiencias ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard
            dotClass="bg-amber-500"
            label="Hoje"
            value={kpis.hoje}
            sub="Audiências marcadas para hoje"
          />
          <KpiCard
            dotClass="bg-[#0b2148]"
            label="Esta semana"
            value={kpis.prox7}
            sub="Nos próximos 7 dias"
          />
          <KpiCard
            dotClass="bg-red-500"
            label="Passadas em aberto"
            value={kpis.atrasados}
            sub="Já ocorreram e não foram concluídas"
          />
          <KpiCard
            dotClass="bg-slate-400"
            label="Histórico"
            value={kpis.concluidos}
            sub="Audiências concluídas"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard
            dotClass="bg-red-500"
            label="Atrasados"
            value={kpis.atrasados}
            sub="Precisam de ação imediata"
          />
          <KpiCard
            dotClass="bg-amber-500"
            label="Vencem hoje"
            value={kpis.hoje}
            sub="Data limite é hoje"
          />
          <KpiCard
            dotClass="bg-[#0b2148]"
            label="Próximos 7 dias"
            value={kpis.prox7}
            sub="Na semana que vem"
          />
          <KpiCard
            dotClass="bg-slate-400"
            label="Concluídos"
            value={kpis.concluidos}
            sub="Encerrados no sistema"
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
                  : "Cliente (nome ou CPF), prazo, processo..."
              }
              aria-label="Buscar por cliente"
              className={cn(inputShell, "h-10 pl-9")}
            />
          </div>
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
          {!isAudiencias && (
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
                {PRAZO_TIPOS.map((t) => (
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
                className="data-checked:bg-[#0b2148]"
              />
              {isAudiencias ? "Mostrar histórico" : "Mostrar concluídos"} (
              {kpis.concluidos})
            </label>
            <span className="text-xs text-[#94a3b8]">
              Concluídos são apagados automaticamente após 30 dias.
            </span>
          </div>
          <p className="text-sm text-[#64748B]">
            <span className="font-semibold text-[#0b2148]">
              {visiveis.length}
            </span>{" "}
            {isAudiencias ? "audiências no filtro" : "prazos no filtro"}
          </p>
        </div>
      </div>

      {prazos.length === 0 ? (
        isAudiencias ? (
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
        <>
          <FaixaAtrasados
            atrasados={atrasados}
            isAudiencias={isAudiencias}
            acoes={acoes}
            processos={processos}
            todayIso={todayIso}
          />
          <PrazosCalendario
            prazos={visiveis}
            todayIso={todayIso}
            isAudiencias={isAudiencias}
            acoes={acoes}
            processos={processos}
          />
        </>
      )}
    </div>
  );
}

/* ---------- Faixa de atrasados ---------- */

function FaixaAtrasados({
  atrasados,
  isAudiencias,
  acoes,
  processos,
  todayIso,
}: {
  atrasados: PrazoEnriched[];
  isAudiencias: boolean;
  acoes: Acoes;
  processos?: PrazoProcessoOption[];
  todayIso: string;
}) {
  const [aberta, setAberta] = useState(true);
  if (!atrasados.length) return null;
  const n = atrasados.length;
  const titulo = isAudiencias
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
  isAudiencias,
  acoes,
  processos,
}: {
  prazos: PrazoEnriched[];
  todayIso: string;
  isAudiencias: boolean;
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
          isAudiencias={isAudiencias}
        />
      )}
      {visao === "dia" && (
        <VisaoDia
          dia={refIso}
          todayIso={todayIso}
          itens={porDia.get(refIso) ?? []}
          acoes={acoes}
          processos={processos}
          isAudiencias={isAudiencias}
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
  isAudiencias,
}: {
  dias: string[];
  todayIso: string;
  porDia: Map<string, PrazoEnriched[]>;
  acoes: Acoes;
  processos?: PrazoProcessoOption[];
  onAbrirDia: (iso: string) => void;
  isAudiencias: boolean;
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
                {isAudiencias ? "Sem audiências" : "Sem prazos"}
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
  isAudiencias,
}: {
  dia: string;
  todayIso: string;
  itens: PrazoEnriched[];
  acoes: Acoes;
  processos?: PrazoProcessoOption[];
  isAudiencias: boolean;
}) {
  if (!itens.length) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-[#64748B]">
        <p>
          {isAudiencias
            ? "Nenhuma audiência neste dia."
            : "Nenhum prazo neste dia."}
        </p>
        <NovoPrazoDialog
          fixedTipo={isAudiencias ? "audiencia" : undefined}
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
