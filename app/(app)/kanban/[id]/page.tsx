import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import { CasoDetail } from "@/components/kanban/caso-detail";

export default async function CasoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAppUser();
  if (!user) notFound();

  const [{ data: caso }, { data: notas }, { data: documentos }] = await Promise.all([
    supabase.from("casos_novos").select("*").eq("id", Number(id)).single(),
    supabase
      .from("app_notas_caso")
      .select("*")
      .eq("caso_id", Number(id))
      .order("created_at", { ascending: false }),
    supabase
      .from("documentos_cliente")
      .select("*")
      .eq("caso_id", Number(id))
      .order("created_at", { ascending: false }),
  ]);

  if (!caso) notFound();

  return (
    <CasoDetail caso={caso} notas={notas ?? []} documentos={documentos ?? []} user={user} />
  );
}
