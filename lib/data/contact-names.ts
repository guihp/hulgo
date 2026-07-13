import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export async function getContactNameMap(
  supabase: SupabaseClient<Database>
): Promise<Record<string, string>> {
  const nameMap: Record<string, string> = {};

  const [casosRes, processosRes] = await Promise.all([
    supabase
      .from("casos_novos")
      .select("telefone, nome")
      .order("updated_at", { ascending: false }),
    supabase
      .from("processos_clientes")
      .select("telefone, nome")
      .order("id", { ascending: true }),
  ]);

  // Primeiro cadastro por telefone — duplicatas não sobrescrevem
  for (const row of processosRes.data ?? []) {
    if (!row.telefone || !row.nome?.trim()) continue;
    const digits = row.telefone.replace(/\D/g, "");
    if (digits && !nameMap[digits]) nameMap[digits] = row.nome.trim();
  }

  // Caso de triagem tem prioridade quando o nome está preenchido
  for (const row of casosRes.data ?? []) {
    if (!row.telefone || !row.nome?.trim()) continue;
    const digits = row.telefone.replace(/\D/g, "");
    if (digits) nameMap[digits] = row.nome.trim();
  }

  return nameMap;
}
