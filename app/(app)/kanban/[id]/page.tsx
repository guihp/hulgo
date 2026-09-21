import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fichaPessoaHref } from "@/lib/utils/ficha";

/** A ficha da pessoa virou o hub do caso — mantemos os links antigos vivos. */
export default async function CasoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: caso } = await supabase
    .from("casos_novos")
    .select("id, cpf, telefone")
    .eq("id", Number(id))
    .single();

  if (!caso) notFound();
  if (!caso.cpf && !caso.telefone) redirect("/kanban");

  redirect(
    fichaPessoaHref({
      cpf: caso.cpf,
      contactNorm: caso.telefone,
      aba: "caso",
      casoId: caso.id,
    })
  );
}
