/** Helpers de lembretes de prazo (offsets em minutos antes do deadline). */

export type LembretePreset =
  | "na_hora"
  | "5min"
  | "15min"
  | "1hora"
  | "1dia"
  | "outro";

export type LembreteDraft = {
  /** chave local estável (UI) */
  key: string;
  preset: LembretePreset;
  /** só quando preset === "outro" */
  customAmount?: number;
  customUnit?: "minutes" | "days";
};

export type LembreteInput = {
  offset_minutes: number;
  label?: string | null;
};

export const DEFAULT_LEMBRETES: LembreteDraft[] = [
  { key: "def-1h", preset: "1hora" },
  { key: "def-0", preset: "na_hora" },
];

export const LEMBRETE_PRESET_OPTIONS: {
  value: LembretePreset;
  label: string;
  offset?: number;
}[] = [
  { value: "na_hora", label: "Somente no horário", offset: 0 },
  { value: "5min", label: "5 min antes", offset: 5 },
  { value: "15min", label: "15 min antes", offset: 15 },
  { value: "1hora", label: "1 hora antes", offset: 60 },
  { value: "1dia", label: "1 dia antes", offset: 1440 },
  { value: "outro", label: "Outro…" },
];

/** Mapa value→label para Base UI Select (evita mostrar chaves cruas no trigger). */
export const LEMBRETE_PRESET_LABELS: Record<LembretePreset, string> =
  Object.fromEntries(
    LEMBRETE_PRESET_OPTIONS.map((o) => [o.value, o.label])
  ) as Record<LembretePreset, string>;

export const CUSTOM_UNIT_LABELS: Record<"minutes" | "days", string> = {
  minutes: "minutos",
  days: "dias",
};

/** Horário legado quando `hora_prazo` é null (date-only). */
export const HORA_PRAZO_LEGACY_EOD = "23:59:59";

export function labelForOffset(offsetMinutes: number): string {
  switch (offsetMinutes) {
    case 0:
      return "Somente no horário";
    case 5:
      return "5 min antes";
    case 15:
      return "15 min antes";
    case 60:
      return "1 hora antes";
    case 1440:
      return "1 dia antes";
    default:
      if (offsetMinutes % 1440 === 0) {
        const d = offsetMinutes / 1440;
        return `${d} dia${d === 1 ? "" : "s"} antes`;
      }
      if (offsetMinutes % 60 === 0) {
        const h = offsetMinutes / 60;
        return `${h} hora${h === 1 ? "" : "s"} antes`;
      }
      return `${offsetMinutes} min antes`;
  }
}

export function offsetFromDraft(draft: LembreteDraft): number {
  if (draft.preset === "na_hora") return 0;
  if (draft.preset === "5min") return 5;
  if (draft.preset === "15min") return 15;
  if (draft.preset === "1hora") return 60;
  if (draft.preset === "1dia") return 1440;
  const amount = Math.max(0, Math.floor(Number(draft.customAmount) || 0));
  const unit = draft.customUnit === "days" ? "days" : "minutes";
  return unit === "days" ? amount * 1440 : amount;
}

export function draftFromOffset(
  offsetMinutes: number,
  key: string
): LembreteDraft {
  if (offsetMinutes === 0) return { key, preset: "na_hora" };
  if (offsetMinutes === 5) return { key, preset: "5min" };
  if (offsetMinutes === 15) return { key, preset: "15min" };
  if (offsetMinutes === 60) return { key, preset: "1hora" };
  if (offsetMinutes === 1440) return { key, preset: "1dia" };
  if (offsetMinutes % 1440 === 0) {
    return {
      key,
      preset: "outro",
      customAmount: offsetMinutes / 1440,
      customUnit: "days",
    };
  }
  return {
    key,
    preset: "outro",
    customAmount: offsetMinutes,
    customUnit: "minutes",
  };
}

export function draftsToInputs(drafts: LembreteDraft[]): LembreteInput[] {
  const seen = new Set<number>();
  const out: LembreteInput[] = [];
  for (const d of drafts) {
    const offset = offsetFromDraft(d);
    if (seen.has(offset)) continue;
    seen.add(offset);
    out.push({
      offset_minutes: offset,
      label: labelForOffset(offset),
    });
  }
  return out;
}

/**
 * Normaliza `hora_prazo` (Postgres time / input type=time) para HH:MM:SS.
 * Aceita HH:MM e HH:MM:SS. Retorna null se vazio/inválido.
 */
export function normalizeHoraPrazo(
  hora: string | null | undefined
): string | null {
  if (hora == null) return null;
  const raw = String(hora).trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] != null ? Number(m[3]) : 0;
  if (
    !Number.isFinite(hh) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(ss) ||
    hh < 0 ||
    hh > 23 ||
    mm < 0 ||
    mm > 59 ||
    ss < 0 ||
    ss > 59
  ) {
    return null;
  }
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** HH:MM para inputs `type="time"`. */
export function horaPrazoForInput(hora: string | null | undefined): string {
  const n = normalizeHoraPrazo(hora);
  if (!n) return "";
  return n.slice(0, 5);
}

/**
 * Deadline em America/Sao_Paulo.
 * Com hora_prazo: data + hora. Sem hora (legado): 23:59:59 SP.
 */
export function deadlineSaoPaulo(
  dataPrazoYmd: string,
  horaPrazo?: string | null
): Date {
  const time =
    normalizeHoraPrazo(horaPrazo) ?? HORA_PRAZO_LEGACY_EOD;
  // BRT fixo -03:00 (sem DST desde 2019)
  return new Date(`${dataPrazoYmd}T${time}-03:00`);
}

/** @deprecated Use deadlineSaoPaulo — mantido para callers legados. */
export function deadlineSaoPauloEod(dataPrazoYmd: string): Date {
  return deadlineSaoPaulo(dataPrazoYmd, null);
}

export function fireAtFromPrazo(
  dataPrazoYmd: string,
  offsetMinutes: number,
  horaPrazo?: string | null
): Date {
  const deadline = deadlineSaoPaulo(dataPrazoYmd, horaPrazo);
  return new Date(deadline.getTime() - offsetMinutes * 60_000);
}

/** Exibe data (e horário quando houver) em pt-BR. */
export function formatPrazoDateTime(
  dataPrazoYmd: string,
  horaPrazo?: string | null
): string {
  const d = new Date(`${dataPrazoYmd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dataPrazoYmd;
  const dataStr = d.toLocaleDateString("pt-BR");
  const hora = normalizeHoraPrazo(horaPrazo);
  if (!hora) return dataStr;
  return `${dataStr} às ${hora.slice(0, 5)}`;
}

export function newLembreteKey(): string {
  return `l-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
