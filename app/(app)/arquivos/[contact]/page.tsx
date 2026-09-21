import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fichaPessoaHref } from "@/lib/utils/ficha";
import { normalizeCpf } from "@/lib/utils/cpf";
import { phoneToContactNorm } from "@/lib/utils/phone";

export default async function ArquivosContatoPage({
  params,
}: {
  params: Promise<{ contact: string }>;
}) {
  const { contact: contactParam } = await params;
  const contactNorm = phoneToContactNorm(contactParam);
  if (!contactNorm) notFound();

  const supabase = await createClient();
  const [{ data: casos }, { data: processos }] = await Promise.all([
    supabase.from("casos_novos").select("cpf, telefone"),
    supabase.from("processos_clientes").select("cpf, telefone"),
  ]);

  const cpfDoContato =
    [...(casos ?? []), ...(processos ?? [])].find(
      (row) =>
        phoneToContactNorm(row.telefone) === contactNorm && row.cpf
    )?.cpf ?? null;

  const href = fichaPessoaHref({
    cpf: cpfDoContato ? normalizeCpf(cpfDoContato) : null,
    contactNorm,
    hash: "arquivos",
  });
  redirect(href);
}
