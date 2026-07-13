import { createClient } from "@/lib/supabase/server";
import { getWhatsAppInstancia } from "@/lib/config/app-config";
import { getContactNameMap } from "@/lib/data/contact-names";
import { getDadosClienteNameMap } from "@/lib/data/dados-cliente-names";
import { AtendimentosPanel } from "@/components/atendimentos/atendimentos-ui";

export default async function AtendimentosPage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>;
}) {
  const { contact } = await searchParams;
  const supabase = await createClient();

  const [{ data }, contactNames, dadosClienteNames, whatsappInstancia] =
    await Promise.all([
      supabase
        .from("mensagens")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
      getContactNameMap(supabase),
      getDadosClienteNameMap(),
      getWhatsAppInstancia(contact ?? undefined),
    ]);

  const allContactNames = { ...dadosClienteNames, ...contactNames };

  return (
    <div className="flex h-[calc(100dvh-9.5rem)] min-h-0 flex-col gap-3 overflow-hidden">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">Atendimentos</h1>
        <p className="text-muted-foreground">
          Conversas do WhatsApp via agente de IA
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <AtendimentosPanel
          initialMessages={data ?? []}
          initialContact={contact ?? null}
          contactNames={allContactNames}
          whatsappInstancia={whatsappInstancia}
        />
      </div>
    </div>
  );
}
