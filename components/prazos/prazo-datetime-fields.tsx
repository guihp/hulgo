"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  brazilianDateToIso,
  isoToBrazilianDate,
  maskBrazilianDateInput,
  maskBrazilianTimeInput,
} from "@/lib/utils/dates";
import { horaPrazoForInput } from "@/lib/prazos/lembretes";
import { cn } from "@/lib/utils";

const HORAS_24 = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0")
);
const MINUTOS_60 = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, "0")
);

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const inputShell =
  "border-[#e2e8f0] bg-white text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12";

const WHEEL_H = 220;
const WHEEL_ITEM = 44;
const WHEEL_PAD = (WHEEL_H - WHEEL_ITEM) / 2;

const SCROLLBAR_HIDDEN: CSSProperties = {
  msOverflowStyle: "none",
  scrollbarWidth: "none",
};

function ScrollWheel({
  options,
  value,
  onChange,
  label,
  open,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  label: string;
  open: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.max(0, options.indexOf(value));
    el.scrollTop = idx * WHEEL_ITEM;
  }, [open, options, value]);

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#64748B]">
        {label}
      </span>
      <div className="relative w-[4.5rem] overflow-hidden rounded-xl border border-[#e2e8f0] bg-[#F8FAFC] shadow-inner">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-1.5 top-1/2 z-10 h-11 -translate-y-1/2 rounded-lg bg-[#0b2148]/10 ring-1 ring-[#0b2148]/20"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-12 bg-gradient-to-b from-[#F8FAFC] via-[#F8FAFC]/85 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-12 bg-gradient-to-t from-[#F8FAFC] via-[#F8FAFC]/85 to-transparent"
        />
        <div
          ref={scrollerRef}
          data-prazo-wheel=""
          className="relative z-0 overflow-y-auto overscroll-contain"
          style={{ height: WHEEL_H, ...SCROLLBAR_HIDDEN }}
          onScroll={(e) => {
            const el = e.currentTarget;
            window.clearTimeout(Number(el.dataset.snapTimer || 0));
            el.dataset.snapTimer = String(
              window.setTimeout(() => {
                const idx = Math.round(el.scrollTop / WHEEL_ITEM);
                const clamped = Math.max(0, Math.min(options.length - 1, idx));
                el.scrollTo({ top: clamped * WHEEL_ITEM, behavior: "smooth" });
                const next = options[clamped];
                if (next && next !== value) onChange(next);
              }, 80)
            );
          }}
        >
          <div style={{ height: WHEEL_PAD }} />
          {options.map((opt) => {
            const selected = value === opt;
            return (
              <button
                key={opt}
                type="button"
                className={cn(
                  "flex w-full shrink-0 items-center justify-center tabular-nums transition-all",
                  selected
                    ? "text-[1.375rem] font-bold tracking-tight text-[#0b2148]"
                    : "text-lg font-medium text-[#94a3b8] hover:text-[#64748B]"
                )}
                style={{ height: WHEEL_ITEM }}
                onClick={() => {
                  onChange(opt);
                  const el = scrollerRef.current;
                  if (!el) return;
                  const idx = options.indexOf(opt);
                  el.scrollTo({ top: idx * WHEEL_ITEM, behavior: "smooth" });
                }}
              >
                {opt}
              </button>
            );
          })}
          <div style={{ height: WHEEL_PAD }} />
        </div>
      </div>
    </div>
  );
}

const CAL_GRID_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
  gap: "0.125rem",
};

function PortugueseCalendar({
  valueIso,
  onSelectIso,
}: {
  valueIso: string;
  onSelectIso: (iso: string) => void;
}) {
  const today = useMemo(() => new Date(), []);

  const selected = useMemo(() => {
    if (!valueIso) return today;
    try {
      return parseISO(valueIso);
    } catch {
      return today;
    }
  }, [valueIso, today]);

  const [cursor, setCursor] = useState(() => selected);

  useEffect(() => {
    setCursor(selected);
  }, [selected]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  return (
    <div className="w-[280px] p-1">
      <div className="mb-2 flex items-center justify-between gap-1">
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-[#64748B] hover:bg-[#0b2148]/5 hover:text-[#0b2148]"
          onClick={() => setCursor((d) => addMonths(d, -1))}
          aria-label="Mês anterior"
        >
          <ChevronLeft className="size-4" />
        </button>
        <p className="min-w-0 truncate text-sm font-semibold capitalize text-[#0b2148]">
          {format(cursor, "MMMM yyyy", { locale: ptBR })}
        </p>
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-[#64748B] hover:bg-[#0b2148]/5 hover:text-[#0b2148]"
          onClick={() => setCursor((d) => addMonths(d, 1))}
          aria-label="Próximo mês"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div style={CAL_GRID_STYLE} className="mb-1">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="py-1 text-center text-[10px] font-semibold uppercase text-[#94a3b8]"
          >
            {d}
          </div>
        ))}
      </div>
      <div style={CAL_GRID_STYLE}>
        {days.map((day) => {
          const inMonth = isSameMonth(day, cursor);
          const isSel = isSameDay(day, selected);
          const isToday = isSameDay(day, today);
          const iso = format(day, "yyyy-MM-dd");
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectIso(iso)}
              className={cn(
                "flex aspect-square w-full items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                !inMonth && "text-[#cbd5e1]",
                inMonth && !isSel && "text-[#0b2148] hover:bg-[#0b2148]/8",
                isToday && !isSel && "ring-1 ring-[#0b2148]/30",
                isSel && "bg-[#0b2148] font-medium text-white"
              )}
            >
              {format(day, "d")}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="mt-2 w-full rounded-md py-1.5 text-xs font-medium text-[#0b2148] hover:bg-[#0b2148]/5"
        onClick={() => onSelectIso(format(new Date(), "yyyy-MM-dd"))}
      >
        Hoje
      </button>
    </div>
  );
}

export function PrazoDateInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const valueIso = brazilianDateToIso(value) ?? "";

  return (
    <div className="relative">
      <Input
        className={cn(inputShell, "pr-10")}
        value={value}
        onChange={(e) => onChange(maskBrazilianDateInput(e.target.value))}
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        aria-label="Data do prazo"
      />
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next && !brazilianDateToIso(value)) {
            onChange(isoToBrazilianDate(format(new Date(), "yyyy-MM-dd")));
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger
          className="absolute inset-y-0 right-0 z-10 flex w-9 items-center justify-center rounded-r-lg text-[#64748B] transition-colors hover:bg-[#0b2148]/5 hover:text-[#0b2148]"
          aria-label="Abrir calendário"
        >
          <Calendar className="size-4" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={6}
          className="w-auto min-w-[296px] border-[#e2e8f0] bg-white p-2 shadow-lg"
        >
          <PortugueseCalendar
            valueIso={valueIso || format(new Date(), "yyyy-MM-dd")}
            onSelectIso={(iso) => {
              onChange(isoToBrazilianDate(iso));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function PrazoTimeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const horaNorm = horaPrazoForInput(value);
  const horaSel = horaNorm.slice(0, 2) || "08";
  const minutoSel = horaNorm.slice(3, 5) || "00";

  return (
    <div className="relative">
      <Input
        className={cn(inputShell, "pr-10")}
        value={value}
        onChange={(e) => onChange(maskBrazilianTimeInput(e.target.value))}
        onBlur={() => {
          const n = horaPrazoForInput(value);
          if (n) onChange(n);
        }}
        inputMode="numeric"
        placeholder="HH:mm"
        aria-label="Horário do prazo"
      />
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next && !horaPrazoForInput(value)) {
            onChange("08:00");
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger
          className="absolute inset-y-0 right-0 z-10 flex w-9 items-center justify-center rounded-r-lg text-[#64748B] transition-colors hover:bg-[#0b2148]/5 hover:text-[#0b2148]"
          aria-label="Escolher horário (0–23 h)"
        >
          <Clock className="size-4" />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={6}
          className="w-auto border-[#e2e8f0] bg-white p-4 shadow-lg"
        >
          <div className="flex items-center gap-3">
            <ScrollWheel
              label="Hora"
              options={HORAS_24}
              value={horaSel}
              open={open}
              onChange={(h) => onChange(`${h}:${minutoSel}`)}
            />
            <span className="mt-6 text-2xl font-bold leading-none text-[#0b2148]">
              :
            </span>
            <ScrollWheel
              label="Min"
              options={MINUTOS_60}
              value={minutoSel}
              open={open}
              onChange={(m) => onChange(`${horaSel}:${m}`)}
            />
          </div>
          <p className="mt-3 text-center text-[11px] text-[#94a3b8]">
            24 h · role ou toque
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
