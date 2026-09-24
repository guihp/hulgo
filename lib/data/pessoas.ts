import { CASO_STATUS } from "@/lib/constants";
import { normalizeCpf } from "@/lib/utils/cpf";
import { fichaPessoaHref } from "@/lib/utils/ficha";
import { phoneToContactNorm } from "@/lib/utils/phone";
import type { Tables } from "@/types/database";

type Processo = Tables<"processos_clientes">;
type Caso = Tables<"casos_novos">;

export type PessoaParceiroRef = {
  id: string;
  nome: string;
  cidade: string;
};

export type PessoaListaItem = {
  key: string;
  href: string;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  nProcessos: number;
  nCasos: number;
  /** Benefício principal (caso tem prioridade sobre processo). */
  beneficio: string | null;
  /** Todos os benefícios distintos (caso + processos). */
  beneficios: string[];
  /** Cidades dos parceiros vinculados aos processos. */
  cidades: string[];
  /** IDs de app_parceiros vinculados aos processos. */
  parceiroIds: string[];
  statusCaso: string | null;
};

function statusLabel(status: string | null | undefined) {
  return CASO_STATUS.find((s) => s.value === status)?.label ?? status ?? null;
}

function pushUnique(list: string[], value: string | null | undefined) {
  const v = value?.trim();
  if (!v) return;
  if (!list.includes(v)) list.push(v);
}

export function agruparPessoas(
  processos: Processo[],
  casos: Caso[],
  parceiros: PessoaParceiroRef[] = []
): PessoaListaItem[] {
  const parceirosById = new Map(parceiros.map((p) => [p.id, p]));

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

  function upsert(
    partial: Omit<
      PessoaListaItem,
      "nProcessos" | "nCasos" | "beneficios" | "cidades" | "parceiroIds"
    > & {
      nProcessos?: number;
      nCasos?: number;
      beneficios?: string[];
      cidades?: string[];
      parceiroIds?: string[];
    }
  ) {
    const existing = byKey.get(partial.key);
    if (!existing) {
      byKey.set(partial.key, {
        ...partial,
        nProcessos: partial.nProcessos ?? 0,
        nCasos: partial.nCasos ?? 0,
        beneficios: [...(partial.beneficios ?? [])],
        cidades: [...(partial.cidades ?? [])],
        parceiroIds: [...(partial.parceiroIds ?? [])],
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
    for (const b of partial.beneficios ?? []) pushUnique(existing.beneficios, b);
    for (const c of partial.cidades ?? []) pushUnique(existing.cidades, c);
    for (const id of partial.parceiroIds ?? []) {
      pushUnique(existing.parceiroIds, id);
    }
    if (!existing.statusCaso && partial.statusCaso) {
      existing.statusCaso = partial.statusCaso;
    }
    if (partial.cpf && existing.href.includes("/contato/")) {
      existing.href = fichaPessoaHref({ cpf: partial.cpf });
    }
  }

  // Casos primeiro: benefício do caso tem prioridade; processo preenche se ainda vazio.
  for (const c of casos) {
    const phone = phoneToContactNorm(c.telefone);
    const cpf =
      (c.cpf ? normalizeCpf(c.cpf) : "") ||
      (phone ? phoneToCpf.get(phone) : "") ||
      "";
    const key = cpf ? `cpf:${cpf}` : phone ? `tel:${phone}` : `caso:${c.id}`;
    const beneficio = c.beneficio_identificado?.trim() || null;
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
      beneficio,
      beneficios: beneficio ? [beneficio] : [],
      cidades: [],
      parceiroIds: [],
      statusCaso: statusLabel(c.status),
    });
  }

  for (const p of processos) {
    const cpf = normalizeCpf(p.cpf);
    const phone = phoneToContactNorm(p.telefone);
    const beneficio = p.beneficio_identificado?.trim() || null;
    const parceiro = p.parceiro_id
      ? parceirosById.get(p.parceiro_id)
      : undefined;
    const cidade = parceiro?.cidade?.trim() || null;
    upsert({
      key: `cpf:${cpf}`,
      href: fichaPessoaHref({ cpf, contactNorm: phone }),
      nome: p.nome?.trim() || "Sem nome",
      cpf,
      telefone: p.telefone,
      nProcessos: 1,
      beneficio,
      beneficios: beneficio ? [beneficio] : [],
      cidades: cidade ? [cidade] : [],
      parceiroIds: p.parceiro_id ? [p.parceiro_id] : [],
      statusCaso: null,
    });
  }

  return [...byKey.values()].sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR")
  );
}
