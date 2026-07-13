export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Celular BR sem o nono dígito (JID antigo do WhatsApp):
 * 55 + DDD + 8 dígitos começando em 6-9 → insere o 9.
 * Mesma regra da função SQL normalize_phone_digits.
 */
export function fixNonoDigitoBr(digits: string): string {
  if (
    digits.length === 12 &&
    digits.startsWith("55") &&
    "6789".includes(digits[4])
  ) {
    return digits.slice(0, 4) + "9" + digits.slice(4);
  }
  if (digits.length === 10 && "6789".includes(digits[2])) {
    return digits.slice(0, 2) + "9" + digits.slice(2);
  }
  return digits;
}

/** Máscara de digitação: (19) 9 8194-1604 */
export function maskPhoneBrInput(value: string): string {
  let digits = normalizePhone(value);
  if (digits.startsWith("55")) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length === 3) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 7) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7)}`;
}

/** Salva com DDI 55: 5519981941604 (corrige nono dígito ausente) */
export function normalizePhoneBrStorage(value: string): string {
  const digits = fixNonoDigitoBr(normalizePhone(value));
  if (digits.length === 11 || digits.length === 10) return `55${digits}`;
  if (digits.length === 13 && digits.startsWith("55")) return digits;
  return digits;
}

export function formatPhone(value: string): string {
  return maskPhoneBrInput(value);
}

export function phoneToContactNorm(value: string | null | undefined): string {
  if (!value) return "";
  return fixNonoDigitoBr(normalizePhone(value.split("@")[0]));
}
