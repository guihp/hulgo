"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarClock,
  Check,
  ExternalLink,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
  MapPin,
  Video,
} from "lucide-react";
import {
  atualizarPrazo,
  criarPrazo,
  concluirPrazo,
  excluirPrazo,
} from "@/lib/actions/prazos";
import type { PrazoTipo, Tables } from "@/types/database";
import { PRAZO_TIPOS } from "@/lib/utils/beneficios";
import {
  CUSTOM_UNIT_LABELS,
  DEFAULT_LEMBRETES,
  LEMBRETE_PRESET_LABELS,
  LEMBRETE_PRESET_OPTIONS,
  draftFromOffset,
  draftsToInputs,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PrazoDateInput,
  PrazoTimeInput,
} from "@/components/prazos/prazo-datetime-fields";
import { fichaPessoaHref } from "@/lib/utils/ficha";
import { brazilianDateToIso, isoToBrazilianDate } from "@/lib/utils/dates";
import { formatNumeroProcesso } from "@/lib/utils/processo";
import {
  isModalidadeAudiencia,
  MODALIDADES_AUDIENCIA,
  type ModalidadeAudiencia,
} from "@/lib/utils/processos";
import {
  diffDaysIso,
  formatConcluidoEm,
  isIsoDate,
  todaySaoPauloIso,
} from "@/lib/prazos/calendario";
import { cn } from "@/lib/utils";

type Prazo = Tables<"app_prazos">;
type PrazoLembrete = Tables<"app_prazos_lembretes">;

export type PrazoEnriched = Prazo & {
  cliente_nome?: string | null;
  numero_processo?: string | null;
  parceiro_id?: string | null;
  parceiro_nome?: string | null;
  lembretes?: PrazoLembrete[];
};

export type PrazoParceiroOption = { id: string; nome: string };

export const fieldLabel =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748B]";

export const inputShell =
  "border-[#e2e8f0] bg-white text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12";

/** Dias até o prazo; `todayIso` = dia civil em Brasília (padrão: agora). */
export function diasAtePrazo(dataPrazo: string, todayIso?: string) {
  if (!isIsoDate(dataPrazo)) return 0;
  return diffDaysIso(dataPrazo, todayIso ?? todaySaoPauloIso());
}

export function prazoUrgencia(
  dataPrazo: string,
  concluido: boolean,
  todayIso?: string
) {
  if (concluido)
    return {
      label: "Concluído",
      pill: "border-slate-200 bg-slate-50 text-slate-600",
      badge: "secondary" as const,
      classes: "",
    };
  const dias = diasAtePrazo(dataPrazo, todayIso);
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

export function tipoBadgeClasses(tipo: string) {
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
    if (prazo.tipo === "audiencia") {
      return fichaPessoaHref({ cpf: prazo.cpf, aba: "audiencias" });
    }
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
  if (prazo.numero_processo) parts.push(formatNumeroProcesso(prazo.numero_processo));
  return parts.join(" · ") || prazo.descricao || "Sem vínculo de cliente";
}

function AudienciaInfo({ prazo }: { prazo: Prazo }) {
  if (prazo.tipo !== "audiencia") return null;
  const modalidade = MODALIDADES_AUDIENCIA.find(
    (m) => m.value === prazo.modalidade
  )?.label;
  if (!modalidade && !prazo.local && !prazo.link_audiencia) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#64748B]">
      {modalidade && (
        <span className="inline-flex items-center gap-1">
          {prazo.modalidade === "virtual" ? (
            <Video className="size-3.5" />
          ) : (
            <MapPin className="size-3.5" />
          )}
          {modalidade}
        </span>
      )}
      {prazo.local && <span className="truncate">{prazo.local}</span>}
      {prazo.link_audiencia && (
        <a
          href={prazo.link_audiencia}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-[#0b2148] hover:underline"
        >
          Entrar na sala
          <ExternalLink className="size-3" />
        </a>
      )}
    </span>
  );
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

export function matchesBusca(prazo: PrazoEnriched, q: string) {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  const hay = [
    prazo.titulo,
    prazo.descricao,
    prazo.cpf,
    prazo.cliente_nome,
    prazo.numero_processo,
    prazo.local,
    tipoLabel(prazo.tipo),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hay.includes(needle)) return true;
  const digits = needle.replace(/\D/g, "");
  if (digits.length < 3) return false;
  return [prazo.cpf, prazo.numero_processo].some((v) =>
    (v ?? "").replace(/\D/g, "").includes(digits)
  );
}

/** Classes do chip na grade do calendário (urgência > tipo). */
export function prazoChipClasses(prazo: Prazo, todayIso?: string) {
  if (prazo.concluido) {
    return "border-slate-200 bg-slate-50 text-slate-500 line-through opacity-70";
  }
  const dias = diasAtePrazo(prazo.data_prazo, todayIso);
  if (dias < 0) return "border-red-200 bg-red-50 text-red-800";
  if (dias === 0) return "border-amber-200 bg-amber-50 text-amber-900";
  return tipoBadgeClasses(prazo.tipo);
}

/* ---------- Ações (concluir com desfazer / excluir) ---------- */

export function usePrazoAcoes(opts?: { audiencia?: boolean }) {
  const router = useRouter();
  const feminino = !!opts?.audiencia;
  const substantivo = feminino ? "Audiência" : "Prazo";
  const sufixo = feminino ? "a" : "o";

  const toggle = useCallback(
    async (prazo: Prazo) => {
      const concluir = !prazo.concluido;
      try {
        await concluirPrazo(prazo.id, concluir);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro");
        return;
      }
      if (!concluir) {
        toast.success(`${substantivo} reabert${sufixo}`);
        return;
      }
      toast.success(`${substantivo} concluíd${sufixo}`, {
        duration: 6000,
        action: {
          label: "Desfazer",
          onClick: async () => {
            try {
              await concluirPrazo(prazo.id, false);
              router.refresh();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Erro");
            }
          },
        },
      });
    },
    [router, substantivo, sufixo]
  );

  const remover = useCallback(
    async (id: number) => {
      try {
        await excluirPrazo(id);
        toast.success(`${substantivo} excluíd${sufixo}`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro");
      }
    },
    [router, substantivo, sufixo]
  );

  return { toggle, remover };
}

/**
 * Aberto: botão verde "Concluir" (só ícone + tooltip no celular).
 * Concluído: selo "Concluído em dd/mm" + "Reabrir".
 */
export function ConcluirPrazoButton({
  prazo,
  onToggle,
  compactLabel = true,
}: {
  prazo: Prazo;
  onToggle: (p: Prazo) => void | Promise<void>;
  /** true: texto some no celular (fica só o ícone). */
  compactLabel?: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function run() {
    if (pending) return;
    setPending(true);
    try {
      await onToggle(prazo);
    } finally {
      setPending(false);
    }
  }

  if (prazo.concluido) {
    const em = formatConcluidoEm(prazo.concluido_em);
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
          <Check className="size-3" />
          {em ? `Concluído em ${em}` : "Concluído"}
        </span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="border-[#e2e8f0] text-[#64748B] hover:text-[#0b2148]"
          disabled={pending}
          onClick={run}
        >
          <RotateCcw />
          Reabrir
        </Button>
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        disabled={pending}
        onClick={run}
        aria-label="Concluir"
        className={cn(
          buttonVariants({ size: "sm" }),
          "bg-emerald-600 text-white hover:bg-emerald-700",
          compactLabel && "max-sm:size-7 max-sm:px-0"
        )}
      >
        <Check />
        <span className={cn(compactLabel && "max-sm:sr-only")}>Concluir</span>
      </TooltipTrigger>
      <TooltipContent className={cn(!compactLabel && "hidden", "sm:hidden")}>
        Concluir
      </TooltipContent>
    </Tooltip>
  );
}

/* ---------- Item da grade (popover com detalhes) ---------- */

export function PrazoPopoverItem({
  prazo,
  todayIso,
  onToggle,
  onRemove,
  processos,
  className,
  children,
}: {
  prazo: PrazoEnriched;
  todayIso?: string;
  onToggle: (p: Prazo) => void | Promise<void>;
  onRemove: (id: number) => void;
  processos?: PrazoProcessoOption[];
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const urg = prazoUrgencia(prazo.data_prazo, prazo.concluido, todayIso);
  const href = prazoHref(prazo);
  const meta = metaLine(prazo);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={className}
          title={prazo.titulo}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(20rem,calc(100vw-2rem))] gap-3 border-[#e2e8f0] bg-white p-3"
        >
          <div className="space-y-1.5">
            <p
              className={cn(
                "text-sm font-semibold text-[#0b2148]",
                prazo.concluido && "text-[#64748B] line-through"
              )}
            >
              {prazo.titulo}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn("text-[11px] font-medium", tipoBadgeClasses(prazo.tipo))}
              >
                {tipoLabel(prazo.tipo)}
              </Badge>
              {!prazo.concluido && (
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    urg.pill
                  )}
                >
                  {urg.label}
                </span>
              )}
            </div>
            <p className="text-xs text-[#64748B]">
              {formatPrazoDateTime(prazo.data_prazo, prazo.hora_prazo)}
            </p>
            {meta !== prazo.descricao && (
              <p className="text-xs text-[#64748B]">{meta}</p>
            )}
            {prazo.parceiro_nome && (
              <p className="text-xs text-[#64748B]">
                Parceiro: {prazo.parceiro_nome}
              </p>
            )}
            <div className="empty:hidden">
              <AudienciaInfo prazo={prazo} />
            </div>
            {prazo.descricao && (
              <p className="line-clamp-3 text-xs text-[#94a3b8]">
                {prazo.descricao}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-t border-[#e2e8f0] pt-2.5">
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
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-[#e2e8f0] text-[#0b2148]"
              onClick={() => {
                setOpen(false);
                setEditOpen(true);
              }}
            >
              <Pencil />
              Editar
            </Button>
            <ConcluirPrazoButton
              prazo={prazo}
              onToggle={onToggle}
              compactLabel={false}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ml-auto text-[#94a3b8] hover:bg-red-50 hover:text-red-600"
              onClick={() => {
                setOpen(false);
                onRemove(prazo.id);
              }}
              aria-label="Excluir"
            >
              <X className="size-4" />
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <EditarPrazoDialog
        prazo={prazo}
        open={editOpen}
        onOpenChange={setEditOpen}
        processos={processos}
      />
    </>
  );
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

export type PrazoProcessoOption = {
  id: number;
  numero_processo: string;
  nome?: string | null;
  cpf?: string | null;
};

const PROCESSO_NENHUM = "__none__";
const MODALIDADE_NENHUMA = "__none__";

export type AudienciaDraft = {
  local: string;
  modalidade: ModalidadeAudiencia | "";
  link: string;
};

const EMPTY_AUDIENCIA: AudienciaDraft = { local: "", modalidade: "", link: "" };

function audienciaFromPrazo(prazo: Prazo): AudienciaDraft {
  return {
    local: prazo.local ?? "",
    modalidade: isModalidadeAudiencia(prazo.modalidade) ? prazo.modalidade : "",
    link: prazo.link_audiencia ?? "",
  };
}

function audienciaToInput(tipo: PrazoTipo, a: AudienciaDraft) {
  if (tipo !== "audiencia") {
    return { local: null, modalidade: null, link_audiencia: null };
  }
  return {
    local: a.local.trim() || null,
    modalidade: a.modalidade || null,
    link_audiencia: a.link.trim() || null,
  };
}

function linkAudienciaInvalido(tipo: PrazoTipo, a: AudienciaDraft) {
  const link = a.link.trim();
  return tipo === "audiencia" && !!link && !/^https?:\/\//i.test(link);
}

function processoOptionLabel(p: PrazoProcessoOption) {
  const numero = formatNumeroProcesso(p.numero_processo);
  return p.nome ? `${numero} · ${p.nome}` : numero;
}

function PrazoFormFields({
  titulo,
  setTitulo,
  tipo,
  setTipo,
  tipoFixo = false,
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
  audiencia,
  setAudiencia,
  processos,
  processoSel,
  setProcessoSel,
}: {
  titulo: string;
  setTitulo: (v: string) => void;
  tipo: PrazoTipo;
  setTipo: (v: PrazoTipo) => void;
  tipoFixo?: boolean;
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
  audiencia: AudienciaDraft;
  setAudiencia: (v: AudienciaDraft) => void;
  processos?: PrazoProcessoOption[];
  processoSel?: string;
  setProcessoSel?: (v: string) => void;
}) {
  const isAudiencia = tipo === "audiencia";
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className={fieldLabel}>Título</Label>
        <Input
          className={inputShell}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder={
            isAudiencia
              ? "Ex.: Audiência de conciliação — Maria Silva"
              : "Ex.: Responder exigência do INSS — Maria Silva"
          }
        />
      </div>
      {!tipoFixo && (
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
      )}
      {processos && processos.length > 0 && setProcessoSel && (
        <div className="space-y-1.5">
          <Label className={fieldLabel}>Processo</Label>
          <Select
            value={processoSel || PROCESSO_NENHUM}
            onValueChange={(v) =>
              setProcessoSel(!v || v === PROCESSO_NENHUM ? "" : String(v))
            }
          >
            <SelectTrigger className={cn(inputShell, "w-full")}>
              <SelectValue>
                {(v) => {
                  if (!v || v === PROCESSO_NENHUM) return "Sem processo";
                  const p = processos.find((x) => String(x.id) === v);
                  return p ? processoOptionLabel(p) : "Processo";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PROCESSO_NENHUM}>Sem processo</SelectItem>
              {processos.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {processoOptionLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label className={fieldLabel}>
          {isAudiencia ? "Data e horário da audiência" : "Data e horário do prazo"}
        </Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <PrazoDateInput value={data} onChange={setData} />
          <PrazoTimeInput value={hora} onChange={setHora} />
        </div>
        <p className="text-xs text-[#94a3b8]">
          Deadline em horário de Brasília — lembretes contam a partir deste
          instante
        </p>
      </div>
      {isAudiencia && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className={fieldLabel}>Modalidade</Label>
              <Select
                value={audiencia.modalidade || MODALIDADE_NENHUMA}
                onValueChange={(v) =>
                  setAudiencia({
                    ...audiencia,
                    modalidade: isModalidadeAudiencia(v) ? v : "",
                  })
                }
              >
                <SelectTrigger className={cn(inputShell, "w-full")}>
                  <SelectValue>
                    {(v) =>
                      MODALIDADES_AUDIENCIA.find((m) => m.value === v)?.label ??
                      "Não informada"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MODALIDADE_NENHUMA}>Não informada</SelectItem>
                  {MODALIDADES_AUDIENCIA.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className={fieldLabel}>Local</Label>
              <Input
                className={inputShell}
                value={audiencia.local}
                onChange={(e) =>
                  setAudiencia({ ...audiencia, local: e.target.value })
                }
                placeholder="Ex.: Fórum de Mirinzal, sala 2"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className={fieldLabel}>Link da audiência</Label>
            <Input
              className={inputShell}
              value={audiencia.link}
              onChange={(e) => setAudiencia({ ...audiencia, link: e.target.value })}
              placeholder="https://..."
              inputMode="url"
              aria-invalid={linkAudienciaInvalido(tipo, audiencia) || undefined}
            />
            {linkAudienciaInvalido(tipo, audiencia) && (
              <p className="text-xs text-red-600">
                O link deve começar com http:// ou https://
              </p>
            )}
          </div>
        </>
      )}
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
  fixedTipo,
  processos,
  triggerLabel,
  triggerVariant = "default",
  triggerClassName,
  defaultDataIso,
}: {
  cpf?: string | null;
  casoId?: number;
  processoId?: number;
  /** Trava o tipo (ex.: "audiencia") e esconde o seletor. */
  fixedTipo?: PrazoTipo;
  /** Quando informado, mostra seletor de processo (default = `processoId`). */
  processos?: PrazoProcessoOption[];
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "secondary";
  triggerClassName?: string;
  /** Data inicial (yyyy-MM-dd) ao abrir; padrão = hoje. */
  defaultDataIso?: string;
}) {
  const router = useRouter();
  const tipoInicial: PrazoTipo = fixedTipo ?? "outro";
  const isAudienciaFixa = fixedTipo === "audiencia";
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<PrazoTipo>(tipoInicial);
  const [audiencia, setAudiencia] = useState<AudienciaDraft>(EMPTY_AUDIENCIA);
  const processoInicial = processoId ? String(processoId) : "";
  const [processoSel, setProcessoSel] = useState(processoInicial);
  const [data, setData] = useState(() =>
    isoToBrazilianDate(defaultDataIso ?? todaySaoPauloIso())
  );

  function handleOpenChange(next: boolean) {
    if (next) setData(isoToBrazilianDate(defaultDataIso ?? todaySaoPauloIso()));
    setOpen(next);
  }
  const [hora, setHora] = useState("08:00");
  const [lembretes, setLembretes] = useState<LembreteDraft[]>(() =>
    DEFAULT_LEMBRETES.map((d) => ({ ...d }))
  );
  const [descricao, setDescricao] = useState("");
  const [cpfManual, setCpfManual] = useState("");
  const [loading, setLoading] = useState(false);

  const processoSelecionado = processos?.find(
    (p) => String(p.id) === processoSel
  );
  const cpfFinal =
    cpf ?? (processoSelecionado?.cpf || cpfManual.trim() || undefined);
  const processoIdFinal = processos
    ? processoSel
      ? Number(processoSel)
      : undefined
    : processoId;
  const substantivo = tipo === "audiencia" ? "Audiência" : "Prazo";

  function reset() {
    setTitulo("");
    setData(isoToBrazilianDate(defaultDataIso ?? todaySaoPauloIso()));
    setHora("08:00");
    setLembretes(DEFAULT_LEMBRETES.map((d) => ({ ...d })));
    setDescricao("");
    setCpfManual("");
    setTipo(tipoInicial);
    setAudiencia(EMPTY_AUDIENCIA);
    setProcessoSel(processoInicial);
  }

  async function salvar() {
    const dataIso = brazilianDateToIso(data);
    if (!dataIso) {
      toast.error("Data inválida");
      return;
    }
    const horaNorm = horaPrazoForInput(hora);
    if (!horaNorm) {
      toast.error("Horário inválido (use HH:mm)");
      return;
    }
    if (linkAudienciaInvalido(tipo, audiencia)) {
      toast.error("Link da audiência deve começar com http:// ou https://");
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
        processo_id: processoIdFinal,
        ...(tipo === "audiencia" ? audienciaToInput(tipo, audiencia) : {}),
      });
      toast.success(`${substantivo} criad${tipo === "audiencia" ? "a" : "o"}`);
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        className={cn(
          buttonVariants({ variant: triggerVariant }),
          "gap-2 bg-[#0b2148] text-white hover:bg-[#163a7a]",
          triggerVariant !== "default" &&
            "bg-transparent text-[#0b2148] hover:bg-[#0b2148]/5",
          triggerClassName
        )}
      >
        <Plus className="h-4 w-4" />{" "}
        {triggerLabel ?? (isAudienciaFixa ? "Nova audiência" : "Novo prazo")}
      </DialogTrigger>
      <DialogContent className="gap-0 overflow-hidden border-[#e2e8f0] bg-white p-0 sm:max-w-md">
        <DialogHeader className="shrink-0 space-y-1 border-b border-[#e2e8f0] px-4 py-3 pr-12">
          <DialogTitle className="text-lg font-bold text-[#0b2148]">
            {isAudienciaFixa ? "Nova audiência" : "Novo prazo"}
          </DialogTitle>
          <DialogDescription className="text-[#64748B]">
            {isAudienciaFixa
              ? "Data, local ou link da audiência e lembretes por push."
              : "Cadastre exigências, recursos, perícias e audiências."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <PrazoFormFields
            titulo={titulo}
            setTitulo={setTitulo}
            tipo={tipo}
            setTipo={setTipo}
            tipoFixo={!!fixedTipo}
            data={data}
            setData={setData}
            hora={hora}
            setHora={setHora}
            lembretes={lembretes}
            setLembretes={setLembretes}
            descricao={descricao}
            setDescricao={setDescricao}
            showCpf={!cpf && !processoSelecionado?.cpf}
            cpfManual={cpfManual}
            setCpfManual={setCpfManual}
            audiencia={audiencia}
            setAudiencia={setAudiencia}
            processos={processos}
            processoSel={processoSel}
            setProcessoSel={setProcessoSel}
          />
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 flex-row justify-stretch gap-2 rounded-none border-[#e2e8f0] bg-[#F8FAFC] pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="min-w-0 flex-1 border-[#e2e8f0] text-[#0b2148] sm:flex-none"
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
          <Button
            className="min-w-0 flex-1 bg-[#0b2148] text-white hover:bg-[#163a7a] sm:flex-none"
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
  processos,
}: {
  prazo: PrazoEnriched;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  processos?: PrazoProcessoOption[];
}) {
  const router = useRouter();
  const [audiencia, setAudiencia] = useState<AudienciaDraft>(() =>
    audienciaFromPrazo(prazo)
  );
  const [processoSel, setProcessoSel] = useState(
    prazo.processo_id ? String(prazo.processo_id) : ""
  );
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
    setAudiencia({
      local: prazo.local ?? "",
      modalidade: isModalidadeAudiencia(prazo.modalidade) ? prazo.modalidade : "",
      link: prazo.link_audiencia ?? "",
    });
    setProcessoSel(prazo.processo_id ? String(prazo.processo_id) : "");
  }, [
    open,
    prazo.id,
    prazo.titulo,
    prazo.tipo,
    prazo.data_prazo,
    prazo.hora_prazo,
    prazo.descricao,
    prazo.lembretes,
    prazo.local,
    prazo.modalidade,
    prazo.link_audiencia,
    prazo.processo_id,
  ]);

  async function salvar() {
    const dataIso = brazilianDateToIso(data);
    if (!dataIso) {
      toast.error("Data inválida");
      return;
    }
    const horaNorm = horaPrazoForInput(hora);
    if (!horaNorm) {
      toast.error("Horário inválido (use HH:mm)");
      return;
    }
    if (linkAudienciaInvalido(tipo, audiencia)) {
      toast.error("Link da audiência deve começar com http:// ou https://");
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
        ...(processos
          ? { processo_id: processoSel ? Number(processoSel) : null }
          : {}),
        ...audienciaToInput(tipo, audiencia),
      });
      toast.success(tipo === "audiencia" ? "Audiência atualizada" : "Prazo atualizado");
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
      <DialogContent className="gap-0 overflow-hidden border-[#e2e8f0] bg-white p-0 sm:max-w-md">
        <DialogHeader className="shrink-0 space-y-1 border-b border-[#e2e8f0] px-4 py-3 pr-12">
          <DialogTitle className="text-lg font-bold text-[#0b2148]">
            {tipo === "audiencia" ? "Editar audiência" : "Editar prazo"}
          </DialogTitle>
          <DialogDescription className="text-[#64748B]">
            Ajuste data, horário e lembretes de notificação.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
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
            audiencia={audiencia}
            setAudiencia={setAudiencia}
            processos={processos}
            processoSel={processoSel}
            setProcessoSel={setProcessoSel}
          />
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-[#e2e8f0] bg-[#F8FAFC]">
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

export function PrazoRowFull({
  prazo,
  onToggle,
  onRemove,
  processos,
  todayIso,
}: {
  prazo: PrazoEnriched;
  onToggle: (p: Prazo) => void | Promise<void>;
  onRemove: (id: number) => void;
  processos?: PrazoProcessoOption[];
  todayIso?: string;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const urg = prazoUrgencia(prazo.data_prazo, prazo.concluido, todayIso);
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
            {prazo.parceiro_nome && (
              <span className="truncate text-xs text-[#94a3b8]">
                Parceiro: {prazo.parceiro_nome}
              </span>
            )}
          </div>
          <div className="mt-1 empty:hidden">
            <AudienciaInfo prazo={prazo} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
        {!prazo.concluido && (
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs font-medium",
              urg.pill
            )}
          >
            {urg.label}
          </span>
        )}
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
        <ConcluirPrazoButton prazo={prazo} onToggle={onToggle} />
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
        processos={processos}
      />
    </li>
  );
}

/* ---------- Lista compacta (ficha cliente / caso) ---------- */

export function PrazosList({
  prazos,
  processos,
}: {
  prazos: PrazoEnriched[];
  processos?: PrazoProcessoOption[];
}) {
  const somenteAudiencias =
    prazos.length > 0 && prazos.every((p) => p.tipo === "audiencia");
  const { toggle, remover } = usePrazoAcoes({ audiencia: somenteAudiencias });
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
          <PrazoRowCompact
            key={p.id}
            prazo={p}
            onToggle={toggle}
            onRemove={remover}
            processos={processos}
          />
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
          <p className="px-3 text-xs text-[#94a3b8]">
            Concluídos são apagados automaticamente após 30 dias.
          </p>
          {mostrarConcluidos && (
            <div className="mt-2 space-y-2">
              {concluidos.map((p) => (
                <PrazoRowCompact
                  key={p.id}
                  prazo={p}
                  onToggle={toggle}
                  onRemove={remover}
                  processos={processos}
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
  processos,
}: {
  prazo: PrazoEnriched;
  onToggle: (p: Prazo) => void | Promise<void>;
  onRemove: (id: number) => void;
  processos?: PrazoProcessoOption[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const urg = prazoUrgencia(prazo.data_prazo, prazo.concluido);

  return (
    <Card className={cn("border-[#e2e8f0]", urg.classes)}>
      <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <div className="min-w-0 flex-1 basis-48">
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
            {prazo.numero_processo && (
              <span className="font-mono">
                {formatNumeroProcesso(prazo.numero_processo)}
              </span>
            )}
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
          <div className="mt-1 empty:hidden">
            <AudienciaInfo prazo={prazo} />
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {!prazo.concluido && (
            <Badge variant={urg.badge} className="shrink-0">
              {urg.label}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-[#0b2148]"
            onClick={() => setEditOpen(true)}
            aria-label="Editar prazo"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <ConcluirPrazoButton prazo={prazo} onToggle={onToggle} />
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground"
            onClick={() => onRemove(prazo.id)}
            aria-label="Excluir prazo"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
      <EditarPrazoDialog
        prazo={prazo}
        open={editOpen}
        onOpenChange={setEditOpen}
        processos={processos}
      />
    </Card>
  );
}
