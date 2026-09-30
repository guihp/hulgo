/**
 * Datas do calendário de prazos como strings `yyyy-MM-dd` (dia civil em
 * America/Sao_Paulo). Evita divergência servidor (UTC) × navegador na
 * hidratação: "hoje" vem sempre de `todaySaoPauloIso`.
 */
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";

export const PRAZOS_TZ = "America/Sao_Paulo";

export type PrazoVisao = "dia" | "semana" | "mes";

export const PRAZO_VISOES: { value: PrazoVisao; label: string }[] = [
  { value: "dia", label: "Dia" },
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mês" },
];

export function isPrazoVisao(v: unknown): v is PrazoVisao {
  return v === "dia" || v === "semana" || v === "mes";
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

const ymdSaoPaulo = new Intl.DateTimeFormat("en-CA", {
  timeZone: PRAZOS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todaySaoPauloIso(now: Date = new Date()): string {
  return ymdSaoPaulo.format(now);
}

/** Meio-dia local: aritmética de dias com date-fns sem cair no dia vizinho. */
export function isoToNoon(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function noonToIso(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Dias de calendário `a - b`. */
export function diffDaysIso(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000
  );
}

const WEEK = { weekStartsOn: 1 as const };

/** Dias exibidos na visão (mês = grade completa seg–dom). */
export function diasDaVisao(visao: PrazoVisao, refIso: string): string[] {
  const ref = isoToNoon(refIso);
  let inicio: Date;
  let fim: Date;
  if (visao === "dia") {
    inicio = ref;
    fim = ref;
  } else if (visao === "semana") {
    inicio = startOfWeek(ref, WEEK);
    fim = endOfWeek(ref, WEEK);
  } else {
    inicio = startOfWeek(startOfMonth(ref), WEEK);
    fim = endOfWeek(endOfMonth(ref), WEEK);
  }
  const out: string[] = [];
  for (let d = isoToNoon(noonToIso(inicio)); d <= fim; d = addDays(d, 1)) {
    out.push(noonToIso(d));
  }
  return out;
}

export function deslocarRef(
  visao: PrazoVisao,
  refIso: string,
  dir: 1 | -1
): string {
  const ref = isoToNoon(refIso);
  if (visao === "dia") return noonToIso(addDays(ref, dir));
  if (visao === "semana") return noonToIso(addDays(ref, 7 * dir));
  return noonToIso(addMonths(ref, dir));
}

function fmt(d: Date, pattern: string) {
  return format(d, pattern, { locale: ptBR }).replace(".", "");
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function tituloPeriodo(visao: PrazoVisao, refIso: string): string {
  const ref = isoToNoon(refIso);
  if (visao === "dia") {
    return capitalize(fmt(ref, "EEEE, d 'de' MMMM 'de' yyyy"));
  }
  if (visao === "mes") return capitalize(fmt(ref, "MMMM yyyy"));
  const ini = startOfWeek(ref, WEEK);
  const fim = endOfWeek(ref, WEEK);
  const mesmoAno = ini.getFullYear() === fim.getFullYear();
  return `${fmt(ini, mesmoAno ? "d MMM" : "d MMM yyyy")} – ${fmt(fim, "d MMM yyyy")}`;
}

export function formatDiaLongo(iso: string): string {
  return capitalize(fmt(isoToNoon(iso), "EEEE, d 'de' MMMM 'de' yyyy"));
}

export function formatDiaSemanaCurto(iso: string): string {
  return capitalize(fmt(isoToNoon(iso), "EEE"));
}

export function formatDiaMesCurto(iso: string): string {
  return fmt(isoToNoon(iso), "d MMM");
}

export function diaDoMes(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function mesmoMes(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export const DIAS_SEMANA_CURTOS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const ddmmSaoPaulo = new Intl.DateTimeFormat("pt-BR", {
  timeZone: PRAZOS_TZ,
  day: "2-digit",
  month: "2-digit",
});

/** `concluido_em` (timestamptz) → "dd/mm" no fuso de Brasília. */
export function formatConcluidoEm(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return ddmmSaoPaulo.format(d);
}
