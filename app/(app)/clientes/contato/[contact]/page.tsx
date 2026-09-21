import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FichaTabs } from "@/components/clientes/ficha-tabs";
import { LinkButton } from "@/components/ui/link-button";
import { getAppUser } from "@/lib/actions/auth";
import { loadCasoDaFicha, loadFichaPessoa } from "@/lib/data/ficha";
import { fichaPessoaHref, parseFichaAba } from "@/lib/utils/ficha";
import { phoneToContactNorm } from "@/lib/utils/phone";

export default async function ClienteContatoPage({
  params,
  searchParams,
}: {
  params: Promise<{ contact: string }>;
  searchParams: Promise<{ aba?: string; caso?: string }>;
}) {
  const { contact: contactParam } = await params;
  const { aba, caso: casoParam } = await searchParams;
  const contactNorm = phoneToContactNorm(contactParam);
  if (!contactNorm) notFound();

  const ficha = await loadFichaPessoa({ contactNorm });
  if (!ficha) notFound();

  if (ficha.cpf) {
    redirect(
      fichaPessoaHref({
        cpf: ficha.cpf,
        aba: parseFichaAba(aba) ?? "arquivos",
        casoId: casoParam,
      })
    );
  }

  const [user, casoSelecionado] = await Promise.all([
    getAppUser(),
    loadCasoDaFicha(ficha.casos, casoParam),
  ]);

  return (
    <div className="space-y-4">
      <LinkButton href="/clientes" variant="ghost" size="icon">
        <ArrowLeft className="h-4 w-4" />
      </LinkButton>
      <FichaTabs
        ficha={ficha}
        abaInicial={parseFichaAba(aba) ?? "resumo"}
        casoSelecionado={casoSelecionado}
        user={user}
      />
    </div>
  );
}
