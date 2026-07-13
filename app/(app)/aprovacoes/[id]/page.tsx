import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import { AprovacaoDetail } from "@/components/aprovacoes/aprovacoes-ui";
import { LinkButton } from "@/components/ui/link-button";
import { normalizeCpf } from "@/lib/utils/cpf";
import { phoneToContactNorm } from "@/lib/utils/phone";

export default async function AprovacaoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAppUser();
  if (!user) notFound();

  const { data: aprovacao } = await supabase
    .from("aprovacoes_pendentes")
    .select("*")
    .eq("id", Number(id))
    .single();

  if (!aprovacao) notFound();

  const cpf = normalizeCpf(aprovacao.cpf ?? "");
  const contactNorm = phoneToContactNorm(aprovacao.telefone_cliente);

  const [processos, casoFunil, anteriores, mensagens, decisor] =
    await Promise.all([
      cpf
        ? supabase
            .from("processos_clientes")
            .select("id, numero_processo, tribunal, area, ativo")
            .eq("cpf", cpf)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
      contactNorm
        ? supabase
            .from("casos_novos")
            .select("id, status, beneficio_identificado, nome")
            .ilike("telefone", `%${contactNorm.slice(-8)}%`)
            .order("created_at", { ascending: false })
            .limit(1)
            .then((r) => r.data?.[0] ?? null)
        : Promise.resolve(null),
      cpf
        ? supabase
            .from("aprovacoes_pendentes")
            .select("id, status, created_at, numero_processo, decidido_em")
            .eq("cpf", aprovacao.cpf ?? "")
            .neq("id", aprovacao.id)
            .order("created_at", { ascending: false })
            .limit(5)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
      contactNorm
        ? supabase
            .from("mensagens")
            .select("id, type, text, created_at")
            .eq("contact_norm", contactNorm)
            .order("created_at", { ascending: false })
            .limit(6)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
      aprovacao.decidido_por
        ? supabase
            .from("app_usuarios")
            .select("nome")
            .eq("id", aprovacao.decidido_por)
            .single()
            .then((r) => r.data?.nome ?? null)
        : Promise.resolve(null),
    ]);

  return (
    <div className="space-y-4">
      <LinkButton href="/aprovacoes" variant="ghost" size="icon">
        <ArrowLeft className="h-4 w-4" />
      </LinkButton>
      <AprovacaoDetail
        aprovacao={aprovacao}
        user={user}
        contexto={{
          contactNorm,
          cpf,
          processos,
          casoFunil,
          anteriores,
          mensagens: mensagens.reverse(),
          decisorNome: decisor,
        }}
      />
    </div>
  );
}
