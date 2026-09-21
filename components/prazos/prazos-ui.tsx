"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { differenceInCalendarDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarClock,
  ExternalLink,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { criarPrazo, concluirPrazo, excluirPrazo } from "@/lib/actions/prazos";
import type { PrazoTipo, Tables } from "@/types/database";
import { PRAZO_TIPOS } from "@/lib/utils/beneficios";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils/dates";
import { fichaPessoaHref } from "@/lib/utils/ficha";
import { cn } from "@/lib/utils";

type Prazo = Tables<"app_prazos">;

export type PrazoEnriched = Prazo & {
  cliente_nome?: string | null;
  numero_processo?: string | null;
};

const fieldLabel =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748B]";

const inputShell =
  "border-[#e2e8f0] bg-white text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12";

function diasAtePrazo(dataPrazo: string) {
  return differenceInCalendarDays(
    new Date(dataPrazo + "T12:00:00"),
    new Date()
  );
}

export function prazoUrgencia(dataPrazo: string, concluido: boolean) {
  if (concluido)
    return {
      label: "Concluído",
      pill: "border-slate-200 bg-slate-50 text-slate-600",
      badge: "secondary" as const,
      classes: "",
    };
  const dias = diasAtePrazo(dataPrazo);
  if (dias < 0)
    return {
      label: `${Math.abs(dias)}d atrasado`,
      pill: "border-red-200 bg-red-50 text-red-700",
      badge: "destructive" as const,
      classes: "border-red-200/80 bg-red-50/30",
    };
  if (dias === 0)
    return {
      label: "Vence hoje",
      pill: "border-amber-200 bg-amber-50 text-amber-800",
      badge: "destructive" as const,
      classes: "border-amber-200/80 bg-amber-50/40",
    };
  if (dias <= 7)
    return {
      label: `Em ${dias}d`,
      pill: "border-[#0b2148]/20 bg-[#0b2148]/8 text-[#0b2148]",
      badge: "outline" as const,
      classes: "",
    };
  return {
    label: `Em ${dias}d`,
    pill: "border-slate-200 bg-slate-50 text-slate-600",
    badge: "secondary" as const,
    classes: "",
  };
}

export function tipoLabel(tipo: string) {
  return PRAZO_TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
}

function tipoBadgeClasses(tipo: string) {
  switch (tipo) {
    case "exigencia_inss":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "recurso":
      return "border-red-200 bg-red-50 text-red-800";
    case "pericia":
      return "border-violet-200 bg-violet-50 text-violet-900";
    case "audiencia":
      return "border-[#0b2148]/20 bg-[#0b2148]/8 text-[#0b2148]";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function initialsFromPrazo(prazo: PrazoEnriched) {
  const name = prazo.cliente_nome?.trim() || prazo.titulo.trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function prazoHref(prazo: Prazo) {
  if (prazo.cpf) {
    return fichaPessoaHref({
      cpf: prazo.cpf,
      aba: prazo.caso_id ? "caso" : undefined,
      casoId: prazo.caso_id,
    });
  }
  // sem CPF na linha do prazo: o /kanban/[id] resolve a pessoa e redireciona
  if (prazo.caso_id) return `/kanban/${prazo.caso_id}`;
  return null;
}

function metaLine(prazo: PrazoEnriched) {
  const parts: string[] = [];
  if (prazo.cliente_nome) parts.push(prazo.cliente_nome);
  else if (prazo.cpf) parts.push(`CPF ${prazo.cpf}`);
  if (prazo.numero_processo) parts.push(prazo.numero_processo);
  return parts.join(" · ") || prazo.descricao || "Sem vínculo de cliente";
}

function dateBlockParts(dataPrazo: string) {
  const d = new Date(dataPrazo + "T12:00:00");
  return {
    day: format(d, "dd", { locale: ptBR }),
    month: format(d, "MMM", { locale: ptBR }).replace(".", "").toUpperCase(),
  };
}

type PrazoSecao =
  | "atrasados"
  | "hoje"
  | "proximos7"
  | "maisAdiante"
  | "concluidos";

function secaoDoPrazo(prazo: Prazo): PrazoSecao | null {
  if (prazo.concluido) return "concluidos";
  const dias = diasAtePrazo(prazo.data_prazo);
  if (dias < 0) return "atrasados";
  if (dias === 0) return "hoje";
  if (dias <= 7) return "proximos7";
  return "maisAdiante";
}

const SECAO_CONFIG: Record<
  PrazoSecao,
  { title: string; borderAccent: string; dot: string }
> = {
  atrasados: {
    title: "Atrasados",
    borderAccent: "border-red-500",
    dot: "bg-red-500",
  },
  hoje: {
    title: "Vencem hoje",
    borderAccent: "border-amber-500",
    dot: "bg-amber-500",
  },
  proximos7: {
    title: "Próximos 7 dias",
    borderAccent: "border-[#0b2148]",
    dot: "bg-[#0b2148]",
  },
  maisAdiante: {
    title: "Mais adiante",
    borderAccent: "border-slate-400",
    dot: "bg-slate-400",
  },
  concluidos: {
    title: "Concluídos",
    borderAccent: "border-slate-400",
    dot: "bg-slate-400",
  },
};

function matchesBusca(prazo: PrazoEnriched, q: string) {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  const hay = [
    prazo.titulo,
    prazo.descricao,
    prazo.cpf,
    prazo.cliente_nome,
    prazo.numero_processo,
    tipoLabel(prazo.tipo),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

/* ---------- Dialog de novo prazo (reutilizado em caso/cliente) ---------- */

export function NovoPrazoDialog({
  cpf,
  casoId,
  processoId,
  triggerLabel = "Novo prazo",
  triggerVariant = "default",
  triggerClassName,
}: {
  cpf?: string | null;
  casoId?: number;
  processoId?: number;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "secondary";
  triggerClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<PrazoTipo>("outro");
  const [data, setData] = useState("");
  const [descricao, setDescricao] = useState("");
  const [cpfManual, setCpfManual] = useState("");
  const [lembrarDias, setLembrarDias] = useState<"1" | "3" | "7">("3");
  const [loading, setLoading] = useState(false);

  const cpfFinal = cpf ?? (cpfManual.trim() || undefined);

  async function salvar() {
    setLoading(true);
    try {
      await criarPrazo({
        titulo,
        tipo,
        data_prazo: data,
        descricao,
        cpf: cpfFinal,
        caso_id: casoId,
        processo_id: processoId,
      });
      toast.success("Prazo criado");
      setOpen(false);
      setTitulo("");
      setData("");
      setDescricao("");
      setCpfManual("");
      setTipo("outro");
      setLembrarDias("3");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar prazo");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn(
          buttonVariants({ variant: triggerVariant }),
          "gap-2 bg-[#0b2148] text-white hover:bg-[#163a7a]",
          triggerVariant !== "default" &&
            "bg-transparent text-[#0b2148] hover:bg-[#0b2148]/5",
          triggerClassName
        )}
      >
        <Plus className="h-4 w-4" /> {triggerLabel}
      </DialogTrigger>
      <DialogContent className="border-[#e2e8f0] bg-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-[#0b2148]">
            Novo prazo
          </DialogTitle>
          <DialogDescription className="text-[#64748B]">
            Cadastre exigências, recursos, perícias e audiências.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className={fieldLabel}>Título</Label>
            <Input
              className={inputShell}
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Responder exigência do INSS — Maria Silva"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className={fieldLabel}>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as PrazoTipo)}>
                <SelectTrigger className={inputShell}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRAZO_TIPOS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className={fieldLabel}>Data limite</Label>
              <Input
                type="date"
                className={inputShell}
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
          </div>
          {!cpf && (
            <div className="space-y-1.5">
              <Label className={fieldLabel}>Cliente</Label>
              <Input
                className={inputShell}
                value={cpfManual}
                onChange={(e) => setCpfManual(e.target.value)}
                placeholder="CPF do cliente (opcional)"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className={fieldLabel}>Lembrar antes</Label>
            <div className="flex flex-wrap gap-2">
              {(["1", "3", "7"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setLembrarDias(d)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                    lembrarDias === d
                      ? "border-[#0b2148] bg-[#0b2148]/8 text-[#0b2148]"
                      : "border-[#e2e8f0] bg-white text-[#64748B] hover:border-[#0b2148]/30"
                  )}
                >
                  {d} {d === "1" ? "dia" : "dias"}
                </button>
              ))}
            </div>
            <p className="text-xs text-[#94a3b8]">
              Preferência visual — alertas automáticos em breve.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className={fieldLabel}>Observações</Label>
            <Textarea
              className={cn(inputShell, "min-h-[72px] resize-y")}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
              placeholder="Detalhes opcionais"
            />
          </div>
        </div>
        <DialogFooter className="border-[#e2e8f0] bg-[#F8FAFC]">
          <Button
            type="button"
            variant="outline"
            className="border-[#e2e8f0] text-[#0b2148]"
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
          <Button
            className="bg-[#0b2148] text-white hover:bg-[#163a7a]"
            disabled={loading || !titulo.trim() || !data}
            onClick={salvar}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Página /prazos (layout completo) ---------- */

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

export function PrazosPageContent({ prazos }: { prazos: PrazoEnriched[] }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState<string>("todos");
  const [ocultarConcluidos, setOcultarConcluidos] = useState(false);

  const hojeLabel = format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", {
    locale: ptBR,
  });

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
      const dias = diasAtePrazo(p.data_prazo);
      if (dias < 0) atrasados++;
      else if (dias === 0) hoje++;
      else if (dias <= 7) prox7++;
    }
    return { atrasados, hoje, prox7, concluidos };
  }, [prazos]);

  const filtrados = useMemo(() => {
    return prazos.filter((p) => {
      if (ocultarConcluidos && p.concluido) return false;
      if (tipoFiltro !== "todos" && p.tipo !== tipoFiltro) return false;
      return matchesBusca(p, busca);
    });
  }, [prazos, busca, tipoFiltro, ocultarConcluidos]);

  const porSecao = useMemo(() => {
    const map: Record<PrazoSecao, PrazoEnriched[]> = {
      atrasados: [],
      hoje: [],
      proximos7: [],
      maisAdiante: [],
      concluidos: [],
    };
    for (const p of filtrados) {
      const s = secaoDoPrazo(p);
      if (s) map[s].push(p);
    }
    const sortOpen = (a: Prazo, b: Prazo) =>
      a.data_prazo.localeCompare(b.data_prazo);
    map.atrasados.sort(sortOpen);
    map.hoje.sort(sortOpen);
    map.proximos7.sort(sortOpen);
    map.maisAdiante.sort(sortOpen);
    map.concluidos.sort((a, b) => b.data_prazo.localeCompare(a.data_prazo));
    return map;
  }, [filtrados]);

  const ordemSecoes: PrazoSecao[] = ocultarConcluidos
    ? ["atrasados", "hoje", "proximos7", "maisAdiante"]
    : ["atrasados", "hoje", "proximos7", "maisAdiante", "concluidos"];

  async function toggle(prazo: Prazo) {
    try {
      await concluirPrazo(prazo.id, !prazo.concluido);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  }

  async function remover(id: number) {
    try {
      await excluirPrazo(id);
      toast.success("Prazo excluído");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0b2148]">
            Prazos
          </h1>
          <p className="mt-1 text-sm capitalize text-[#64748B]">{hojeLabel}</p>
        </div>
        <NovoPrazoDialog triggerClassName="shadow-[0_8px_24px_rgba(11,33,72,0.18)]" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

      <div className="flex flex-col gap-3 rounded-xl border border-[#e2e8f0] bg-white p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#94a3b8]" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por prazo, cliente ou processo..."
            className={cn(inputShell, "h-10 pl-9")}
          />
        </div>
        <Select
          value={tipoFiltro}
          onValueChange={(v) => setTipoFiltro(v ?? "todos")}
        >
          <SelectTrigger className={cn(inputShell, "h-10 w-full sm:w-[180px]")}>
            <SelectValue placeholder="Todos os tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            {PRAZO_TIPOS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-[#64748B]">
          <Switch
            checked={ocultarConcluidos}
            onCheckedChange={setOcultarConcluidos}
            className="data-checked:bg-[#0b2148]"
          />
          Ocultar concluídos ({kpis.concluidos})
        </label>
        <p className="text-sm text-[#64748B] sm:ml-auto">
          <span className="font-semibold text-[#0b2148]">{filtrados.length}</span>{" "}
          prazos listados
        </p>
      </div>

      {prazos.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Nenhum prazo cadastrado"
          description="Crie prazos de exigência do INSS, recurso, perícia ou audiência para não perder datas."
        />
      ) : filtrados.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#e2e8f0] bg-white p-8 text-center text-sm text-[#64748B]">
          Nenhum prazo corresponde aos filtros atuais.
        </div>
      ) : (
        <div className="space-y-8">
          {ordemSecoes.map((secao) => {
            const items = porSecao[secao];
            if (!items.length) return null;
            const cfg = SECAO_CONFIG[secao];
            return (
              <section key={secao}>
                <div
                  className={cn(
                    "mb-3 flex items-center gap-3 border-l-4 pl-3",
                    cfg.borderAccent
                  )}
                >
                  <span
                    className={cn("size-2 shrink-0 rounded-full", cfg.dot)}
                    aria-hidden
                  />
                  <h2 className="text-sm font-bold uppercase tracking-wide text-[#0b2148]">
                    {cfg.title}
                  </h2>
                  <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-xs font-semibold text-[#64748B]">
                    {items.length}
                  </span>
                </div>
                <ul className="space-y-2">
                  {items.map((p) => (
                    <PrazoRowFull
                      key={p.id}
                      prazo={p}
                      onToggle={toggle}
                      onRemove={remover}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PrazoRowFull({
  prazo,
  onToggle,
  onRemove,
}: {
  prazo: PrazoEnriched;
  onToggle: (p: Prazo) => void;
  onRemove: (id: number) => void;
}) {
  const urg = prazoUrgencia(prazo.data_prazo, prazo.concluido);
  const { day, month } = dateBlockParts(prazo.data_prazo);
  const href = prazoHref(prazo);
  const dimmed = prazo.concluido;

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-[#e2e8f0] bg-white p-3 shadow-sm transition-opacity sm:flex-row sm:items-center",
        dimmed && "opacity-60",
        urg.classes
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Checkbox
          checked={prazo.concluido}
          onCheckedChange={() => onToggle(prazo)}
          aria-label="Concluir prazo"
          className="shrink-0 data-checked:bg-[#0b2148] data-checked:border-[#0b2148]"
        />
        <div
          className={cn(
            "flex shrink-0 flex-col items-center justify-center rounded-lg border border-[#e2e8f0] bg-[#F8FAFC] px-2.5 py-1.5 text-center",
            dimmed && "border-slate-200 bg-slate-50"
          )}
        >
          <span className="text-lg font-bold leading-none text-[#0b2148]">
            {day}
          </span>
          <span className="text-[10px] font-semibold tracking-wide text-[#64748B]">
            {month}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-semibold text-[#0b2148]",
              dimmed && "text-[#64748B] line-through"
            )}
          >
            {prazo.titulo}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn("text-[11px] font-medium", tipoBadgeClasses(prazo.tipo))}
            >
              {tipoLabel(prazo.tipo)}
            </Badge>
            <span className="truncate text-xs text-[#64748B]">{metaLine(prazo)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs font-medium",
            urg.pill
          )}
        >
          {urg.label}
        </span>
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0b2148]/10 text-xs font-semibold text-[#0b2148]"
          title={prazo.cliente_nome ?? prazo.titulo}
        >
          {initialsFromPrazo(prazo)}
        </span>
        {href ? (
          <Link
            href={href}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "gap-1.5 border-[#0b2148]/25 text-[#0b2148] hover:bg-[#0b2148]/5"
            )}
          >
            Abrir
            <ExternalLink className="size-3.5 opacity-70" />
          </Link>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled
            className="border-[#e2e8f0] text-[#94a3b8]"
          >
            Abrir
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-[#94a3b8] hover:bg-red-50 hover:text-red-600"
          onClick={() => onRemove(prazo.id)}
          aria-label="Excluir prazo"
        >
          <X className="size-4" />
        </Button>
      </div>
    </li>
  );
}

/* ---------- Lista compacta (ficha cliente / caso) ---------- */

export function PrazosList({ prazos }: { prazos: Prazo[] }) {
  const router = useRouter();
  const [mostrarConcluidos, setMostrarConcluidos] = useState(false);

  const { abertos, concluidos } = useMemo(() => {
    const abertos = prazos
      .filter((p) => !p.concluido)
      .sort((a, b) => a.data_prazo.localeCompare(b.data_prazo));
    const concluidos = prazos
      .filter((p) => p.concluido)
      .sort((a, b) => b.data_prazo.localeCompare(a.data_prazo));
    return { abertos, concluidos };
  }, [prazos]);

  async function toggle(prazo: Prazo) {
    try {
      await concluirPrazo(prazo.id, !prazo.concluido);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  }

  async function remover(id: number) {
    try {
      await excluirPrazo(id);
      toast.success("Prazo excluído");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  }

  if (prazos.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Nenhum prazo cadastrado"
        description="Crie prazos de exigência do INSS, recurso, perícia ou audiência para não perder datas."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {abertos.map((p) => (
          <PrazoRowCompact key={p.id} prazo={p} onToggle={toggle} onRemove={remover} />
        ))}
        {abertos.length === 0 && (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Nenhum prazo em aberto. 👌
          </div>
        )}
      </div>

      {concluidos.length > 0 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMostrarConcluidos((v) => !v)}
          >
            {mostrarConcluidos ? "Ocultar" : "Mostrar"} concluídos (
            {concluidos.length})
          </Button>
          {mostrarConcluidos && (
            <div className="mt-2 space-y-2">
              {concluidos.map((p) => (
                <PrazoRowCompact
                  key={p.id}
                  prazo={p}
                  onToggle={toggle}
                  onRemove={remover}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PrazoRowCompact({
  prazo,
  onToggle,
  onRemove,
}: {
  prazo: Prazo;
  onToggle: (p: Prazo) => void;
  onRemove: (id: number) => void;
}) {
  const urg = prazoUrgencia(prazo.data_prazo, prazo.concluido);

  return (
    <Card className={cn("border-[#e2e8f0]", urg.classes)}>
      <CardContent className="flex items-center gap-3 p-3">
        <Checkbox
          checked={prazo.concluido}
          onCheckedChange={() => onToggle(prazo)}
          aria-label="Concluir prazo"
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm font-medium text-[#0b2148]",
              prazo.concluido && "text-muted-foreground line-through"
            )}
          >
            {prazo.titulo}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{formatDate(prazo.data_prazo)}</span>
            <Badge variant="outline" className={tipoBadgeClasses(prazo.tipo)}>
              {tipoLabel(prazo.tipo)}
            </Badge>
            {prazo.caso_id && (
              <Link
                href={prazoHref(prazo) ?? `/kanban/${prazo.caso_id}`}
                className="text-[#0b2148] hover:underline"
              >
                ver caso
              </Link>
            )}
            {prazo.descricao && (
              <span className="truncate">{prazo.descricao}</span>
            )}
          </div>
        </div>
        <Badge variant={urg.badge} className="shrink-0">
          {urg.label}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          onClick={() => onRemove(prazo.id)}
          aria-label="Excluir prazo"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
