import { CASO_STATUS } from "@/lib/constants";
import { normalizeCpf } from "@/lib/utils/cpf";
import { fichaPessoaHref } from "@/lib/utils/ficha";
import { phoneToContactNorm } from "@/lib/utils/phone";
import type { Tables } from "@/types/database";

type Processo = Tables<"processos_clientes">;
type Caso = Tables<"casos_novos">;

export type PessoaListaItem = {
  key: string;
  href: string;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  nProcessos: number;
  nCasos: number;
  beneficio: string | null;
  statusCaso: string | null;
};

function statusLabel(status: string | null | undefined) {
  return CASO_STATUS.find((s) => s.value === status)?.label ?? status ?? null;
}

export function agruparPessoas(
  processos: Processo[],
  casos: Caso[]
): PessoaListaItem[] {
  const phoneToCpf = new Map<string, string>();
  for (const p of processos) {
    const cpf = normalizeCpf(p.cpf);
    const phone = phoneToContactNorm(p.telefone);
    if (cpf && phone) phoneToCpf.set(phone, cpf);
  }
  for (const c of casos) {
    const cpf = c.cpf ? normalizeCpf(c.cpf) : "";
    const phone = phoneToContactNorm(c.telefone);
    if (cpf && phone && !phoneToCpf.has(phone)) phoneToCpf.set(phone, cpf);
  }

  const byKey = new Map<string, PessoaListaItem>();

  function upsert(partial: Omit<PessoaListaItem, "nProcessos" | "nCasos"> & {
    nProcessos?: number;
    nCasos?: number;
  }) {
    const existing = byKey.get(partial.key);
    if (!existing) {
      byKey.set(partial.key, {
        ...partial,
        nProcessos: partial.nProcessos ?? 0,
        nCasos: partial.nCasos ?? 0,
      });
      return;
    }
    existing.nProcessos += partial.nProcessos ?? 0;
    existing.nCasos += partial.nCasos ?? 0;
    if (!existing.nome || existing.nome === "Sem nome") {
      existing.nome = partial.nome;
    }
    if (!existing.cpf && partial.cpf) existing.cpf = partial.cpf;
    if (!existing.telefone && partial.telefone) {
      existing.telefone = partial.telefone;
    }
    if (!existing.beneficio && partial.beneficio) {
      existing.beneficio = partial.beneficio;
    }
    if (!existing.statusCaso && partial.statusCaso) {
      existing.statusCaso = partial.statusCaso;
    }
    if (partial.cpf && existing.href.includes("/contato/")) {
      existing.href = fichaPessoaHref({ cpf: partial.cpf });
    }
  }

  for (const p of processos) {
    const cpf = normalizeCpf(p.cpf);
    const phone = phoneToContactNorm(p.telefone);
    upsert({
      key: `cpf:${cpf}`,
      href: fichaPessoaHref({ cpf, contactNorm: phone }),
      nome: p.nome?.trim() || "Sem nome",
      cpf,
      telefone: p.telefone,
      nProcessos: 1,
      beneficio: null,
      statusCaso: null,
    });
  }

  for (const c of casos) {
    const phone = phoneToContactNorm(c.telefone);
    const cpf = (c.cpf ? normalizeCpf(c.cpf) : "") || (phone ? phoneToCpf.get(phone) : "") || "";
    const key = cpf ? `cpf:${cpf}` : phone ? `tel:${phone}` : `caso:${c.id}`;
    upsert({
      key,
      href: fichaPessoaHref({
        cpf: cpf || null,
        contactNorm: phone || null,
      }),
      nome: c.nome?.trim() || "Sem nome",
      cpf: cpf || null,
      telefone: c.telefone,
      nCasos: 1,
      beneficio: c.beneficio_identificado,
      statusCaso: statusLabel(c.status),
    });
  }

  return [...byKey.values()].sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR")
  );
}
