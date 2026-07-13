import {
  fetchAllDocumentos,
  groupDocumentosPorCliente,
} from "@/lib/data/arquivos";
import { getContactNameMap } from "@/lib/data/contact-names";
import { createClient } from "@/lib/supabase/server";
import { ArquivosGeralPanel } from "@/components/arquivos/arquivos-ui";

export default async function ArquivosPage() {
  const supabase = await createClient();
  const [documentos, contactNames] = await Promise.all([
    fetchAllDocumentos(),
    getContactNameMap(supabase),
  ]);

  const grupos = groupDocumentosPorCliente(documentos, contactNames);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Arquivos</h1>
        <p className="text-muted-foreground">
          Documentos enviados pelos clientes no WhatsApp
        </p>
      </div>
      <ArquivosGeralPanel grupos={grupos} />
    </div>
  );
}
