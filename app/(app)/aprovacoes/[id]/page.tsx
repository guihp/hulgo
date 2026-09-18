import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import { getAprovacaoContexto } from "@/lib/actions/aprovacoes";
import { AprovacaoDetail } from "@/components/aprovacoes/aprovacoes-ui";
import { LinkButton } from "@/components/ui/link-button";

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

  const contexto = await getAprovacaoContexto(aprovacao.id);
  if (!contexto) notFound();

  return (
    <div className="space-y-4">
      <LinkButton href="/aprovacoes" variant="ghost" size="icon">
        <ArrowLeft className="h-4 w-4" />
      </LinkButton>
      <AprovacaoDetail
        aprovacao={aprovacao}
        user={user}
        contexto={contexto}
        variant="page"
      />
    </div>
  );
}
