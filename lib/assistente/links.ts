/**
 * Painel deep-links for assistente tool results / summaries.
 * Prefer these helpers so ficha, pastas and kanban URLs stay consistent.
 */

import { fichaPessoaHref } from "@/lib/utils/ficha";
import { phoneToContactNorm } from "@/lib/utils/phone";

export function assistenteFichaHref(opts: {
  cpf?: string | null;
  contactNorm?: string | null;
}): string {
  return fichaPessoaHref({
    cpf: opts.cpf,
    contactNorm: opts.contactNorm,
  });
}

/**
 * Ficha arquivos section. Optional `pasta` selects a folder via ?pasta=…
 * (geral | caso:{id} | processo:{id} | custom:{nome}) + #arquivos.
 */
export function assistenteFichaArquivosHref(opts: {
  cpf?: string | null;
  contactNorm?: string | null;
  pasta?: string | null;
}): string {
  const path = fichaPessoaHref({
    cpf: opts.cpf,
    contactNorm: opts.contactNorm,
  });
  const pasta = opts.pasta?.trim();
  const qs =
    pasta && pasta !== "geral"
      ? `?pasta=${encodeURIComponent(pasta)}`
      : pasta === "geral"
        ? "?pasta=geral"
        : "";
  return `${path}${qs}#arquivos`;
}

export function assistenteKanbanHref(casoId: number | string): string {
  return `/kanban/${casoId}`;
}

export function assistenteAtendimentoHref(contactNorm: string): string {
  return `/atendimentos/${phoneToContactNorm(contactNorm)}`;
}
