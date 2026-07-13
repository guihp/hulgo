export function normalizeNumeroProcesso(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidNumeroProcesso(value: string): boolean {
  return normalizeNumeroProcesso(value).length === 20;
}

export function formatNumeroProcesso(value: string): string {
  const digits = normalizeNumeroProcesso(value);
  if (digits.length !== 20) return value;
  return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`;
}

/** Máscara progressiva CNJ: 1033284-32.2024.4.01.3700 */
export function maskNumeroProcessoInput(value: string): string {
  const d = normalizeNumeroProcesso(value).slice(0, 20);
  if (!d) return "";
  let out = d.slice(0, 7);
  if (d.length > 7) out += `-${d.slice(7, 9)}`;
  if (d.length > 9) out += `.${d.slice(9, 13)}`;
  if (d.length > 13) out += `.${d.slice(13, 14)}`;
  if (d.length > 14) out += `.${d.slice(14, 16)}`;
  if (d.length > 16) out += `.${d.slice(16)}`;
  return out;
}
