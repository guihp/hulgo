import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Cliente360 } from "@/components/clientes/clientes-ui";
import { DataJudPanel } from "@/components/clientes/datajud-panel";
import { NovoPrazoDialog, PrazosList } from "@/components/prazos/prazos-ui";
import { LinkButton } from "@/components/ui/link-button";
import { loadFichaPessoa } from "@/lib/data/ficha";
import { fichaPessoaHref } from "@/lib/utils/ficha";
import { phoneToContactNorm } from "@/lib/utils/phone";

export default async function ClienteContatoPage({
  params,
}: {
  params: Promise<{ contact: string }>;
}) {
  const { contact: contactParam } = await params;
  const contactNorm = phoneToContactNorm(contactParam);
  if (!contactNorm) notFound();

  const ficha = await loadFichaPessoa({ contactNorm });
  if (!ficha) notFound();

  if (ficha.cpf) {
    redirect(`${fichaPessoaHref({ cpf: ficha.cpf })}#arquivos`);
  }

  return (
    <div className="space-y-4">
      <LinkButton href="/clientes" variant="ghost" size="icon">
        <ArrowLeft className="h-4 w-4" />
      </LinkButton>
      <Cliente360
        cpf={null}
        contactNorm={ficha.contactNorm}
        processos={ficha.processos}
        casos={ficha.casos}
        mensagens={ficha.mensagens}
        documentos={ficha.documentos}
        pastas={ficha.pastas}
        midiasChat={ficha.midiasChat}
      />

      {ficha.processos.map((p) => (
        <DataJudPanel
          key={p.id}
          numeroProcesso={p.numero_processo}
          processoId={p.id}
          monitorarDias={p.monitorar_dias}
          ultimaConsulta={p.ultima_consulta_datajud}
        />
      ))}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Prazos deste cliente</h2>
          <NovoPrazoDialog
            casoId={ficha.casos[0]?.id}
            triggerLabel="Novo prazo"
            triggerVariant="outline"
          />
        </div>
        {ficha.prazos.length > 0 ? (
          <PrazosList prazos={ficha.prazos} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhum prazo cadastrado para este cliente.
          </p>
        )}
      </div>
    </div>
  );
}
