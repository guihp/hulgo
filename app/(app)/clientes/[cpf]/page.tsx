import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FichaTabs } from "@/components/clientes/ficha-tabs";
import { LinkButton } from "@/components/ui/link-button";
import { getAppUser } from "@/lib/actions/auth";
import { loadCasoDaFicha, loadFichaPessoa } from "@/lib/data/ficha";
import { normalizeCpf } from "@/lib/utils/cpf";
import { parseFichaAba } from "@/lib/utils/ficha";

export default async function Cliente360Page({
  params,
  searchParams,
}: {
  params: Promise<{ cpf: string }>;
  searchParams: Promise<{ aba?: string; caso?: string }>;
}) {
  const { cpf: cpfParam } = await params;
  const { aba, caso: casoParam } = await searchParams;
  const cpf = normalizeCpf(cpfParam);
  const ficha = await loadFichaPessoa({ cpf });

  if (!ficha || (!ficha.processos.length && !ficha.casos.length)) {
    notFound();
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
