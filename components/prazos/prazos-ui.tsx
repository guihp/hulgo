"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { differenceInCalendarDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarClock,
  ExternalLink,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  atualizarPrazo,
  criarPrazo,
  concluirPrazo,
  excluirPrazo,
  draftsToInputs,
} from "@/lib/actions/prazos";
import type { PrazoTipo, Tables } from "@/types/database";
import { PRAZO_TIPOS } from "@/lib/utils/beneficios";
import {
  CUSTOM_UNIT_LABELS,
  DEFAULT_LEMBRETES,
  LEMBRETE_PRESET_LABELS,
  LEMBRETE_PRESET_OPTIONS,
  draftFromOffset,
  formatPrazoDateTime,
  horaPrazoForInput,
  newLembreteKey,
  type LembreteDraft,
  type LembretePreset,
} from "@/lib/prazos/lembretes";
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
import {
  PrazoDateInput,
  PrazoTimeInput,
} from "@/components/prazos/prazo-datetime-fields";
import { fichaPessoaHref } from "@/lib/utils/ficha";
import { brazilianDateToIso, isoToBrazilianDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

type Prazo = Tables<"app_prazos">;
type PrazoLembrete = Tables<"app_prazos_lembretes">;

export type PrazoEnriched = Prazo & {
  cliente_nome?: string | null;
  numero_processo?: string | null;
  lembretes?: PrazoLembrete[];
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

function dateBlockParts(dataPrazo: string, horaPrazo?: string | null) {
  const d = new Date(`${dataPrazo}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return { day: "—", month: "—", time: horaPrazoForInput(horaPrazo) || null };
  }
  const hora = horaPrazoForInput(horaPrazo);
  return {
    day: format(d, "dd", { locale: ptBR }),
    month: format(d, "MMM", { locale: ptBR }).replace(".", "").toUpperCase(),
    time: hora || null,
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

/* ---------- Dialog criar / editar prazo ---------- */

function lembretesToDrafts(rows: PrazoLembrete[] | undefined): LembreteDraft[] {
  if (!rows?.length) return DEFAULT_LEMBRETES.map((d) => ({ ...d }));
  return [...rows]
    .sort((a, b) => b.offset_minutes - a.offset_minutes)
    .map((r) => draftFromOffset(r.offset_minutes, `db-${r.id}`));
}

function LembretesEditor({
  lembretes,
  setLembretes,
}: {
  lembretes: LembreteDraft[];
  setLembretes: (v: LembreteDraft[]) => void;
}) {
  function updateAt(index: number, patch: Partial<LembreteDraft>) {
    setLembretes(
      lembretes.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className={fieldLabel}>Lembretes</Label>
          <p className="text-xs text-[#94a3b8]">
            Quando notificar antes ou no horário do prazo
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 border-[#e2e8f0] text-[#0b2148]"
          onClick={() =>
            setLembretes([
              ...lembretes,
              { key: newLembreteKey(), preset: "1hora" },
            ])
          }
        >
          <Plus className="mr-1 size-3.5" />
          Adicionar
        </Button>
      </div>
      <ul className="space-y-2">
        {lembretes.map((row, index) => (
          <li
            key={row.key}
            className="flex flex-col gap-2 rounded-lg border border-[#e2e8f0] bg-[#F8FAFC] p-2.5 sm:flex-row sm:items-center"
          >
            <Select
              value={row.preset}
              onValueChange={(v) => {
                const preset = (v ?? "1hora") as LembretePreset;
                updateAt(index, {
                  preset,
                  ...(preset === "outro"
                    ? {
                        customAmount: row.customAmount ?? 30,
                        customUnit: row.customUnit ?? "minutes",
                      }
                    : {}),
                });
              }}
            >
              <SelectTrigger className={cn(inputShell, "sm:min-w-[180px]")}>
                <SelectValue>
                  {(v) =>
                    LEMBRETE_PRESET_LABELS[(v as LembretePreset) ?? "1hora"] ??
                    "1 hora antes"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {LEMBRETE_PRESET_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {row.preset === "outro" && (
              <div className="flex flex-1 items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  className={cn(inputShell, "w-20")}
                  value={row.customAmount ?? ""}
                  onChange={(e) =>
                    updateAt(index, {
                      customAmount: Number(e.target.value) || 0,
                    })
                  }
                  aria-label="Quantidade"
                />
                <Select
                  value={row.customUnit ?? "minutes"}
                  onValueChange={(v) =>
                    updateAt(index, {
                      customUnit: v === "days" ? "days" : "minutes",
                    })
                  }
                >
                  <SelectTrigger className={cn(inputShell, "w-[120px]")}>
                    <SelectValue>
                      {(v) =>
                        CUSTOM_UNIT_LABELS[
                          (v === "days" ? "days" : "minutes") as
                            | "minutes"
                            | "days"
                        ]
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">minutos</SelectItem>
                    <SelectItem value="days">dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="self-end text-[#94a3b8] hover:bg-red-50 hover:text-red-600 sm:ml-auto sm:self-center"
              disabled={lembretes.length <= 1}
              onClick={() =>
                setLembretes(lembretes.filter((_, i) => i !== index))
              }
              aria-label="Remover lembrete"
            >
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PrazoFormFields({
  titulo,
  setTitulo,
  tipo,
  setTipo,
  data,
  setData,
  hora,
  setHora,
  lembretes,
  setLembretes,
  descricao,
  setDescricao,
  showCpf,
  cpfManual,
  setCpfManual,
}: {
  titulo: string;
  setTitulo: (v: string) => void;
  tipo: PrazoTipo;
  setTipo: (v: PrazoTipo) => void;
  data: string;
  setData: (v: string) => void;
  hora: string;
  setHora: (v: string) => void;
  lembretes: LembreteDraft[];
  setLembretes: (v: LembreteDraft[]) => void;
  descricao: string;
  setDescricao: (v: string) => void;
  showCpf?: boolean;
  cpfManual?: string;
  setCpfManual?: (v: string) => void;
}) {
  return (
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
      <div className="space-y-1.5">
        <Label className={fieldLabel}>Tipo</Label>
        <Select value={tipo} onValueChange={(v) => setTipo(v as PrazoTipo)}>
          <SelectTrigger className={inputShell}>
            <SelectValue>
              {(v) =>
                PRAZO_TIPOS.find((t) => t.value === v)?.label ?? "Tipo"
              }
            </SelectValue>
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
        <Label className={fieldLabel}>Data e horário do prazo</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <PrazoDateInput value={data} onChange={setData} />
          <PrazoTimeInput value={hora} onChange={setHora} />
        </div>
        <p className="text-xs text-[#94a3b8]">
          Deadline em horário de Brasília — lembretes contam a partir deste
          instante
        </p>
      </div>
      {showCpf && setCpfManual && (
        <div className="space-y-1.5">
          <Label className={fieldLabel}>Cliente</Label>
          <Input
            className={inputShell}
            value={cpfManual ?? ""}
            onChange={(e) => setCpfManual(e.target.value)}
            placeholder="CPF do cliente (opcional)"
          />
        </div>
      )}
      <LembretesEditor lembretes={lembretes} setLembretes={setLembretes} />
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
  );
}

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
  const [data, setData] = useState(() =>
    isoToBrazilianDate(format(new Date(), "yyyy-MM-dd"))
  );
  const [hora, setHora] = useState("08:00");
  const [lembretes, setLembretes] = useState<LembreteDraft[]>(() =>
    DEFAULT_LEMBRETES.map((d) => ({ ...d }))
  );
  const [descricao, setDescricao] = useState("");
  const [cpfManual, setCpfManual] = useState("");
  const [loading, setLoading] = useState(false);

  const cpfFinal = cpf ?? (cpfManual.trim() || undefined);

  function reset() {
    setTitulo("");
    setData(isoToBrazilianDate(format(new Date(), "yyyy-MM-dd")));
    setHora("08:00");
    setLembretes(DEFAULT_LEMBRETES.map((d) => ({ ...d })));
    setDescricao("");
    setCpfManual("");
    setTipo("outro");
  }

  async function salvar() {
    const dataIso = brazilianDateToIso(data);
    if (!dataIso) {
      toast.error("Data do prazo inválida");
      return;
    }
    const horaNorm = horaPrazoForInput(hora);
    if (!horaNorm) {
      toast.error("Horário inválido (use HH:mm)");
      return;
    }
    setLoading(true);
    try {
      await criarPrazo({
        titulo,
        tipo,
        data_prazo: dataIso,
        hora_prazo: horaNorm,
        descricao,
        lembretes: draftsToInputs(lembretes),
        cpf: cpfFinal,
        caso_id: casoId,
        processo_id: processoId,
      });
      toast.success("Prazo criado");
      setOpen(false);
      reset();
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
        <PrazoFormFields
          titulo={titulo}
          setTitulo={setTitulo}
          tipo={tipo}
          setTipo={setTipo}
          data={data}
          setData={setData}
          hora={hora}
          setHora={setHora}
          lembretes={lembretes}
          setLembretes={setLembretes}
          descricao={descricao}
          setDescricao={setDescricao}
          showCpf={!cpf}
          cpfManual={cpfManual}
          setCpfManual={setCpfManual}
        />
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
            disabled={
              loading || !titulo.trim() || !brazilianDateToIso(data) || !horaPrazoForInput(hora)
            }
            onClick={salvar}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditarPrazoDialog({
  prazo,
  open,
  onOpenChange,
}: {
  prazo: PrazoEnriched;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [titulo, setTitulo] = useState(prazo.titulo);
  const [tipo, setTipo] = useState<PrazoTipo>(
    (prazo.tipo as PrazoTipo) || "outro"
  );
  const [data, setData] = useState(() => isoToBrazilianDate(prazo.data_prazo));
  const [hora, setHora] = useState(
    () => horaPrazoForInput(prazo.hora_prazo) || "23:59"
  );
  const [lembretes, setLembretes] = useState<LembreteDraft[]>(() =>
    lembretesToDrafts(prazo.lembretes)
  );
  const [descricao, setDescricao] = useState(prazo.descricao ?? "");
  const [loading, setLoading] = useState(false);

  // Sync when opening / switching prazo
  useEffect(() => {
    if (!open) return;
    setTitulo(prazo.titulo);
    setTipo((prazo.tipo as PrazoTipo) || "outro");
    setData(isoToBrazilianDate(prazo.data_prazo));
    setHora(horaPrazoForInput(prazo.hora_prazo) || "23:59");
    setLembretes(lembretesToDrafts(prazo.lembretes));
    setDescricao(prazo.descricao ?? "");
  }, [
    open,
    prazo.id,
    prazo.titulo,
    prazo.tipo,
    prazo.data_prazo,
    prazo.hora_prazo,
    prazo.descricao,
    prazo.lembretes,
  ]);

  async function salvar() {
    const dataIso = brazilianDateToIso(data);
    if (!dataIso) {
      toast.error("Data do prazo inválida");
      return;
    }
    const horaNorm = horaPrazoForInput(hora);
    if (!horaNorm) {
      toast.error("Horário inválido (use HH:mm)");
      return;
    }
    setLoading(true);
    try {
      await atualizarPrazo({
        id: prazo.id,
        titulo,
        tipo,
        data_prazo: dataIso,
        hora_prazo: horaNorm,
        descricao,
        lembretes: draftsToInputs(lembretes),
      });
      toast.success("Prazo atualizado");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao atualizar prazo"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#e2e8f0] bg-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-[#0b2148]">
            Editar prazo
          </DialogTitle>
          <DialogDescription className="text-[#64748B]">
            Ajuste data, horário e lembretes de notificação.
          </DialogDescription>
        </DialogHeader>
        <PrazoFormFields
          titulo={titulo}
          setTitulo={setTitulo}
          tipo={tipo}
          setTipo={setTipo}
          data={data}
          setData={setData}
          hora={hora}
          setHora={setHora}
          lembretes={lembretes}
          setLembretes={setLembretes}
          descricao={descricao}
          setDescricao={setDescricao}
        />
        <DialogFooter className="border-[#e2e8f0] bg-[#F8FAFC]">
          <Button
            type="button"
            variant="outline"
            className="border-[#e2e8f0] text-[#0b2148]"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            className="bg-[#0b2148] text-white hover:bg-[#163a7a]"
            disabled={
              loading || !titulo.trim() || !brazilianDateToIso(data) || !horaPrazoForInput(hora)
            }
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
  const [editOpen, setEditOpen] = useState(false);
  const urg = prazoUrgencia(prazo.data_prazo, prazo.concluido);
  const { day, month, time } = dateBlockParts(
    prazo.data_prazo,
    prazo.hora_prazo
  );
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
          {time && (
            <span className="mt-0.5 text-[10px] font-medium tabular-nums text-[#64748B]">
              {time}
            </span>
          )}
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
          className="text-[#64748B] hover:bg-[#0b2148]/5 hover:text-[#0b2148]"
          onClick={() => setEditOpen(true)}
          aria-label="Editar prazo"
        >
          <Pencil className="size-4" />
        </Button>
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
      <EditarPrazoDialog
        prazo={prazo}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </li>
  );
}

/* ---------- Lista compacta (ficha cliente / caso) ---------- */

export function PrazosList({ prazos }: { prazos: PrazoEnriched[] }) {
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
  prazo: PrazoEnriched;
  onToggle: (p: Prazo) => void;
  onRemove: (id: number) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
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
            <span>
              {formatPrazoDateTime(prazo.data_prazo, prazo.hora_prazo)}
            </span>
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
          className="shrink-0 text-muted-foreground hover:text-[#0b2148]"
          onClick={() => setEditOpen(true)}
          aria-label="Editar prazo"
        >
          <Pencil className="h-4 w-4" />
        </Button>
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
      <EditarPrazoDialog
        prazo={prazo}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </Card>
  );
}
