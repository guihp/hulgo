import { formatDistanceToNow, format, differenceInHours, differenceInDays, isSameDay, subDays, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day, 12, 0, 0);
  return (
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

/**
 * Converte string em Date com tolerância a formatos fora do padrão
 * (ex.: DataJud às vezes retorna "yyyyMMddHHmmss"). Retorna null se inválida.
 */
function parseDate(date: string | null | undefined): Date | null {
  if (!date) return null;

  const isoDateOnly = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateOnly) {
    const year = Number(isoDateOnly[1]);
    const month = Number(isoDateOnly[2]);
    const day = Number(isoDateOnly[3]);
    if (!isRealCalendarDate(year, month, day)) return null;
    const d = new Date(year, month - 1, day, 12, 0, 0);
    return isValid(d) ? d : null;
  }

  let d = new Date(date);
  if (!isValid(d) && /^\d{14}$/.test(date)) {
    d = new Date(
      `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(8, 10)}:${date.slice(10, 12)}:${date.slice(12, 14)}`
    );
  }
  if (!isValid(d) && /^\d{8}$/.test(date)) {
    d = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00`);
  }
  return isValid(d) ? d : null;
}

export function formatRelative(date: string | null | undefined): string {
  const d = parseDate(date);
  if (!d) return "—";
  return formatDistanceToNow(d, { addSuffix: true, locale: ptBR });
}

export function formatDateTime(date: string | null | undefined): string {
  const d = parseDate(date);
  if (!d) return "—";
  return format(d, "dd/MM/yyyy HH:mm", { locale: ptBR });
}

export function formatDate(date: string | null | undefined): string {
  const d = parseDate(date);
  if (!d) return "—";
  return format(d, "dd/MM/yyyy", { locale: ptBR });
}

export function maskBrazilianDateInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function brazilianDateToIso(value: string): string | null {
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (!isRealCalendarDate(year, month, day)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isoToBrazilianDate(value: string | null | undefined): string {
  if (!value) return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isRealCalendarDate(year, month, day)) return "";
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

export function maskNomeInput(value: string): string {
  return value.replace(/[0-9]/g, "");
}

export function caseAgeLabel(date: string | null | undefined): string {
  const d = parseDate(date);
  if (!d) return "—";
  const days = differenceInDays(new Date(), d);
  if (days === 0) return "Hoje";
  if (days === 1) return "1 dia";
  return `${days} dias`;
}

export function isActiveConversation(date: string | null | undefined): boolean {
  const d = parseDate(date);
  if (!d) return false;
  return differenceInHours(new Date(), d) < 24;
}

export function formatChatTime(date: string | null | undefined): string {
  const d = parseDate(date);
  if (!d) return "";
  return format(d, "HH:mm", { locale: ptBR });
}

export function formatChatDateSeparator(date: string | null | undefined): string {
  const d = parseDate(date);
  if (!d) return "";
  const today = new Date();
  if (isSameDay(d, today)) return "Hoje";
  if (isSameDay(d, subDays(today, 1))) return "Ontem";
  return format(d, "dd/MM/yyyy", { locale: ptBR });
}
