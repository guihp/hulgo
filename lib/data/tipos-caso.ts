import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  CHECKLIST_POR_BENEFICIO,
  FALLBACK_TIPOS_CASO,
  type BeneficioChave,
} from "@/lib/utils/beneficios";
import type { Tables } from "@/types/database";

export type TipoCaso = Tables<"app_tipos_caso">;

export type TipoCasoMatch = {
  id: string | null;
  chave: string;
  label: string;
  aliases: string[];
  documentos: string[];
  ativo: boolean;
  ordem: number;
};

function fallbackTipos(): TipoCasoMatch[] {
  return FALLBACK_TIPOS_CASO.map((t) => ({
    id: null,
    chave: t.chave,
    label: t.label,
    aliases: t.aliases,
    documentos: t.documentos,
    ativo: true,
    ordem: t.ordem,
  }));
}

function rowToMatch(row: TipoCaso): TipoCasoMatch {
  return {
    id: row.id,
    chave: row.chave,
    label: row.label,
    aliases: row.aliases ?? [],
    documentos: row.documentos ?? [],
    ativo: row.ativo,
    ordem: row.ordem,
  };
}

/** Lista tipos (ativos por padrão). Se a tabela estiver vazia, usa seed em memória. */
export async function listTiposCaso(opts?: {
  includeInactive?: boolean;
  /** service role — rotas de integração / cron */
  service?: boolean;
}): Promise<TipoCasoMatch[]> {
  const supabase = opts?.service
    ? createServiceClient()
    : await createClient();

  let query = supabase
    .from("app_tipos_caso")
    .select("*")
    .order("ordem", { ascending: true })
    .order("label", { ascending: true });

  if (!opts?.includeInactive) {
    query = query.eq("ativo", true);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  if (!data || data.length === 0) {
    return fallbackTipos().filter((t) => opts?.includeInactive || t.ativo);
  }

  return data.map(rowToMatch);
}

/**
 * Melhor match para `beneficio_identificado`.
 * Ordem da tabela = prioridade (primeiro alias/label que der match).
 * Sem match → chave `outro` se existir; senão checklist genérico.
 */
export function matchTipoCaso(
  tipos: TipoCasoMatch[],
  beneficio: string | null | undefined
): TipoCasoMatch {
  const ativos = tipos.filter((t) => t.ativo);
  const b = (beneficio ?? "").toLowerCase().trim();
  const outro =
    ativos.find((t) => t.chave === "outro") ??
    fallbackTipos().find((t) => t.chave === "outro")!;

  if (!b) return outro;

  for (const tipo of ativos) {
    if (tipo.chave === "outro") continue;
    const aliases = tipo.aliases.length
      ? tipo.aliases
      : [tipo.label, tipo.chave];
    for (const alias of aliases) {
      const a = alias.toLowerCase().trim();
      if (a && b.includes(a)) return tipo;
    }
    const label = tipo.label.toLowerCase();
    if (label && b.includes(label)) return tipo;
  }

  return outro;
}

export async function findTipoCasoByBeneficio(
  beneficio: string | null | undefined,
  opts?: { service?: boolean }
): Promise<TipoCasoMatch> {
  const tipos = await listTiposCaso({ service: opts?.service });
  return matchTipoCaso(tipos, beneficio);
}

export async function checklistDoBeneficio(
  beneficio: string | null | undefined,
  opts?: { service?: boolean }
): Promise<{ chave: string; label: string; docs: string[] }> {
  const tipo = await findTipoCasoByBeneficio(beneficio, opts);
  return {
    chave: tipo.chave,
    label: tipo.label,
    docs: tipo.documentos,
  };
}

/** Chave sync (fallback hardcoded) — útil para requisito etário no client. */
export function chaveDoBeneficioFallback(
  beneficio: string | null | undefined
): BeneficioChave {
  const matched = matchTipoCaso(fallbackTipos(), beneficio);
  const chave = matched.chave as BeneficioChave;
  return chave in CHECKLIST_POR_BENEFICIO ? chave : "outro";
}
