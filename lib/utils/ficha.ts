import { normalizeCpf } from "@/lib/utils/cpf";
import { phoneToContactNorm } from "@/lib/utils/phone";

export function fichaPessoaHref(opts: {
  cpf?: string | null;
  contactNorm?: string | null;
  hash?: string;
}): string {
  const cpf = opts.cpf ? normalizeCpf(opts.cpf) : "";
  const contact = opts.contactNorm
    ? phoneToContactNorm(opts.contactNorm)
    : "";
  const base = cpf
    ? `/clientes/${cpf}`
    : contact
      ? `/clientes/contato/${contact}`
      : "/clientes";
  return opts.hash ? `${base}#${opts.hash}` : base;
}

export function pastaCustomKey(nome: string): string {
  const clean = nome.trim().replace(/\s+/g, " ").slice(0, 80);
  return `custom:${clean}`;
}

export function pastaCustomNome(pasta: string): string {
  return pasta.startsWith("custom:") ? pasta.slice("custom:".length) : pasta;
}

export function storagePastaSegment(pasta: string): string {
  return pasta.replace(/[^a-zA-Z0-9:_-]+/g, "_").slice(0, 80) || "geral";
}
