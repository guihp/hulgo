export function normalizeCpf(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatCpf(value: string): string {
  const digits = normalizeCpf(value);
  if (digits.length !== 11) return value;
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

export function formatCpfCnpj(value: string): string {
  const digits = normalizeCpf(value);
  if (digits.length === 11) return formatCpf(digits);
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return value;
}

export function cpfCnpjDocumentLabel(value: string): "CPF" | "CNPJ" {
  return normalizeCpf(value).length > 11 ? "CNPJ" : "CPF";
}

export function maskCpfCnpjInput(value: string): string {
  const digits = normalizeCpf(value).slice(0, 14);
  if (digits.length <= 11) {
    let out = "";
    for (let i = 0; i < digits.length; i++) {
      out += digits[i];
      if (i === 2 || i === 5) out += ".";
      if (i === 8) out += "-";
    }
    return out;
  }
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function maskCpf(value: string): string {
  const digits = normalizeCpf(value);
  if (digits.length < 2) return "***.***.***-**";
  const lastTwo = digits.slice(-2);
  return `***.***.***-${lastTwo}`;
}

export function isValidCpf(value: string): boolean {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  return digit === Number(cpf[10]);
}
