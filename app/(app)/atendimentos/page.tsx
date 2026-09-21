import { createClient } from "@/lib/supabase/server";
import { getWhatsAppInstancia } from "@/lib/config/app-config";
import { getContactNameMap } from "@/lib/data/contact-names";
import { getDadosClienteNameMap } from "@/lib/data/dados-cliente-names";
import {
  AtendimentosPanel,
  type CasoMetaMap,
} from "@/components/atendimentos/atendimentos-ui";
import { phoneToContactNorm } from "@/lib/utils/phone";

export default async function AtendimentosPage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>;
}) {
  const { contact } = await searchParams;
  const supabase = await createClient();

  const [{ data }, contactNames, dadosClienteNames, whatsappInstancia, casosRes] =
    await Promise.all([
      supabase
        .from("mensagens")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
      getContactNameMap(supabase),
      getDadosClienteNameMap(),
      getWhatsAppInstancia(contact ?? undefined),
      supabase
        .from("casos_novos")
        .select("telefone, status, beneficio_identificado, cpf")
        .order("updated_at", { ascending: false }),
    ]);

  const allContactNames = { ...dadosClienteNames, ...contactNames };

  const casoMeta: CasoMetaMap = {};
  for (const row of casosRes.data ?? []) {
    const key = phoneToContactNorm(row.telefone);
    if (!key || casoMeta[key]) continue;
    casoMeta[key] = {
      status: row.status,
      beneficio: row.beneficio_identificado,
      cpf: row.cpf,
    };
  }

  return (
    <div className="flex h-[calc(100dvh-9.5rem)] min-h-0 flex-col overflow-hidden">
      <AtendimentosPanel
        initialMessages={data ?? []}
        initialContact={contact ?? null}
        contactNames={allContactNames}
        whatsappInstancia={whatsappInstancia}
        casoMeta={casoMeta}
      />
    </div>
  );
}
