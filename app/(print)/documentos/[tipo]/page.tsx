import { notFound } from "next/navigation";
import { DocumentoPdfEditor } from "@/components/documentos/documento-pdf-editor";
import {
  carregarDadosDocumento,
  carregarDocumentoGerado,
} from "@/lib/documentos/gerados";
import { getDocumentoTemplate } from "@/lib/utils/documentos";

export default async function DocumentoPage({
  params,
  searchParams,
}: {
  params: Promise<{ tipo: string }>;
  searchParams: Promise<{ caso?: string; cpf?: string; gerado?: string }>;
}) {
  const { tipo } = await params;
  const { caso: casoId, cpf, gerado } = await searchParams;
  const template = getDocumentoTemplate(tipo);
  if (!template) notFound();

  // Documento preenchido pelo assistente: abre os mesmos valores para revisar.
  const doc = gerado ? await carregarDocumentoGerado(gerado) : null;

  // Cliente ainda sem cadastro (comum no fluxo do assistente): formulário só com
  // os valores preenchidos. Caso inexistente continua 404.
  const dados =
    (await carregarDadosDocumento({
      casoId: casoId ? Number(casoId) : null,
      cpf: cpf ?? doc?.clienteCpf ?? null,
    })) ?? (casoId ? null : await carregarDadosDocumento({}));
  if (!dados) notFound();

  return (
    <DocumentoPdfEditor
      template={template}
      dados={dados}
      valoresPreenchidos={doc && doc.modelo === template.slug ? doc.valores : undefined}
      avisoExpirado={Boolean(gerado) && !doc}
    />
  );
}
