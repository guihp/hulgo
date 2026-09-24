import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CASO_STATUS } from "@/lib/constants";
import type { Tables } from "@/types/database";

export type KanbanColuna = Tables<"app_kanban_colunas">;

export type KanbanColunaMatch = {
  id: string | null;
  chave: string;
  label: string;
  ordem: number;
  ativo: boolean;
  is_system: boolean;
};

function fallbackColunas(): KanbanColunaMatch[] {
  return CASO_STATUS.map((s, i) => ({
    id: null,
    chave: s.value,
    label: s.label,
    ordem: (i + 1) * 10,
    ativo: true,
    is_system: true,
  }));
}

function rowToMatch(row: KanbanColuna): KanbanColunaMatch {
  return {
    id: row.id,
    chave: row.chave,
    label: row.label,
    ordem: row.ordem,
    ativo: row.ativo,
    is_system: row.is_system,
  };
}

/** Lista colunas do funil (ativas por padrão). Fallback = CASO_STATUS em memória. */
export async function listKanbanColunas(opts?: {
  includeInactive?: boolean;
  service?: boolean;
  allowFallback?: boolean;
}): Promise<KanbanColunaMatch[]> {
  const supabase = opts?.service
    ? createServiceClient()
    : await createClient();

  let query = supabase
    .from("app_kanban_colunas")
    .select("*")
    .order("ordem", { ascending: true })
    .order("label", { ascending: true });

  if (!opts?.includeInactive) {
    query = query.eq("ativo", true);
  }

  const { data, error } = await query;
  if (error) {
    if (opts?.allowFallback === false) throw new Error(error.message);
    return fallbackColunas().filter((c) => opts?.includeInactive || c.ativo);
  }

  if (!data || data.length === 0) {
    if (opts?.allowFallback === false) return [];
    return fallbackColunas().filter((c) => opts?.includeInactive || c.ativo);
  }

  return data.map(rowToMatch);
}

export function labelDaColuna(
  chave: string | null | undefined,
  colunas: KanbanColunaMatch[]
): string {
  if (!chave) return "—";
  return colunas.find((c) => c.chave === chave)?.label ?? chave;
}
