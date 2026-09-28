import { normalizeCpf } from "@/lib/utils/cpf";
import { phoneToContactNorm } from "@/lib/utils/phone";

export type FichaAba =
  | "resumo"
  | "caso"
  | "arquivos"
  | "datajud"
  | "prazos"
  | "audiencias";

export const FICHA_ABAS: FichaAba[] = [
  "resumo",
  "caso",
  "arquivos",
  "datajud",
  "prazos",
  "audiencias",
];

export function parseFichaAba(value: string | null | undefined): FichaAba | null {
  const v = (value ?? "").toLowerCase().trim();
  return (FICHA_ABAS as string[]).includes(v) ? (v as FichaAba) : null;
}

export function fichaPessoaHref(opts: {
  cpf?: string | null;
  contactNorm?: string | null;
  hash?: string;
  aba?: FichaAba;
  casoId?: number | string | null;
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
  const query = new URLSearchParams();
  if (opts.aba) query.set("aba", opts.aba);
  if (opts.casoId != null && opts.casoId !== "") {
    query.set("caso", String(opts.casoId));
  }
  const qs = query.toString();
  return `${base}${qs ? `?${qs}` : ""}${opts.hash ? `#${opts.hash}` : ""}`;
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
