export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Após o DDD (2 dígitos), o nono dígito de celular BR é sempre 9.
 * - Se o usuário digitar outro dígito nessa posição enquanto ainda falta número,
 *   o 9 é inserido e o dígito digitado entra nos 8 do assinante.
 * - Se já houver 9 dígitos após o DDD com nono ≠ 9, o nono é sobrescrito por 9.
 * Nunca deixa/exibe/armazena um non-9 nessa posição.
 */
export function forceNonoDigitoAposDdd(nationalDigits: string): string {
  const digits = normalizePhone(nationalDigits);
  if (digits.length <= 2) return digits.slice(0, 2);
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2, 11); // no máx. 9 após DDD (total 11)
  if (rest.length === 0) return ddd;
  if (rest[0] === "9") return ddd + rest.slice(0, 9);
  if (rest.length >= 9) {
    return ddd + "9" + rest.slice(1, 9);
  }
  return ddd + "9" + rest.slice(0, 8);
}

/**
 * Celular BR sem o nono dígito (JID antigo do WhatsApp) ou com nono ≠ 9.
 * Aceita com ou sem DDI 55.
 */
export function fixNonoDigitoBr(digits: string): string {
  const d = normalizePhone(digits);
  if (d.startsWith("55")) {
    return "55" + forceNonoDigitoAposDdd(d.slice(2));
  }
  return forceNonoDigitoAposDdd(d);
}

/** Máscara de digitação: (19) 9 8194-1604 — nono após DDD sempre 9 */
export function maskPhoneBrInput(value: string): string {
  let digits = normalizePhone(value);
  if (digits.startsWith("55")) digits = digits.slice(2);
  digits = forceNonoDigitoAposDdd(digits);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length === 3) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 7) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7)}`;
}

/** Salva com DDI 55: 5519981941604 (sempre força 9 após o DDD) */
export function normalizePhoneBrStorage(value: string): string {
  let digits = normalizePhone(value);
  if (digits.startsWith("55")) {
    digits = "55" + forceNonoDigitoAposDdd(digits.slice(2));
  } else {
    digits = forceNonoDigitoAposDdd(digits);
  }
  if (digits.length === 11 || digits.length === 10) return digits.startsWith("55") ? digits : `55${digits}`;
  if (digits.length === 13 && digits.startsWith("55")) return digits;
  if (digits.length === 12 && digits.startsWith("55")) {
    return "55" + forceNonoDigitoAposDdd(digits.slice(2));
  }
  return digits;
}

/** Garante 55 + DDD + 9 + 8 dígitos (13 no total). */
export function normalizeParceiroTelefone(value: string): string {
  const digits = normalizePhoneBrStorage(value);
  if (digits.length !== 13 || !digits.startsWith("55") || digits[4] !== "9") {
    throw new Error(
      "Telefone inválido. Use DDD + celular (o 9 após o DDD é fixo; ex.: 19 98194-1604 → 5519981941604)."
    );
  }
  return digits;
}

export function formatPhone(value: string): string {
  return maskPhoneBrInput(value);
}

export function phoneToContactNorm(value: string | null | undefined): string {
  if (!value) return "";
  return fixNonoDigitoBr(normalizePhone(value.split("@")[0]));
}
