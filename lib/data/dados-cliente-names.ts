import { createServiceClient } from "@/lib/supabase/service";

export async function getDadosClienteNameMap(): Promise<Record<string, string>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("dados_cliente_testehulgo" as "casos_novos")
    .select("telefone, nome");

  if (error || !data?.length) return {};

  const map: Record<string, string> = {};
  for (const row of data) {
    const telefone = (row as { telefone?: string | null }).telefone;
    const nome = (row as { nome?: string | null }).nome;
    if (!telefone || !nome?.trim()) continue;
    const digits = telefone.replace(/\D/g, "");
    if (digits) map[digits] = nome.trim();
  }
  return map;
}
