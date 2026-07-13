import { notFound } from "next/navigation";
import { fetchArquivosByContact } from "@/lib/data/arquivos";
import { getContactNameMap } from "@/lib/data/contact-names";
import { createClient } from "@/lib/supabase/server";
import { phoneToContactNorm } from "@/lib/utils/phone";
import { ArquivosContatoPanel } from "@/components/arquivos/arquivos-ui";

export default async function ArquivosContatoPage({
  params,
}: {
  params: Promise<{ contact: string }>;
}) {
  const { contact: contactParam } = await params;
  const contactNorm = phoneToContactNorm(contactParam);

  if (!contactNorm) notFound();

  const supabase = await createClient();
  const [arquivos, contactNames] = await Promise.all([
    fetchArquivosByContact(contactNorm),
    getContactNameMap(supabase),
  ]);

  const { documentos, midiasChat, casos } = arquivos;

  if (documentos.length === 0 && midiasChat.length === 0) {
    const { count } = await supabase
      .from("mensagens")
      .select("id", { count: "exact", head: true })
      .eq("contact_norm", contactNorm);

    if (!count) notFound();
  }

  const casoPrincipal = casos[0] ?? null;
  const displayName = contactNames[contactNorm] ?? casoPrincipal?.nome ?? null;
  const phone = casoPrincipal?.telefone ?? contactNorm;
  const cpf = casoPrincipal?.cpf ?? casos.find((c) => c.cpf)?.cpf ?? null;

  return (
    <ArquivosContatoPanel
      contactNorm={contactNorm}
      phone={phone}
      displayName={displayName}
      documentos={documentos}
      midiasChat={midiasChat}
      cpf={cpf}
    />
  );
}
