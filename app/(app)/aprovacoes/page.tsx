import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import { AprovacoesList } from "@/components/aprovacoes/aprovacoes-ui";

export default async function AprovacoesPage() {
  const supabase = await createClient();
  const user = await getAppUser();
  const { data } = await supabase
    .from("aprovacoes_pendentes")
    .select("*")
    .order("created_at", { ascending: false });

  return <AprovacoesList initial={data ?? []} user={user!} />;
}
