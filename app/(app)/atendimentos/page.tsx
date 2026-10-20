import { createClient } from "@/lib/supabase/server";
import { getWhatsAppInstancia } from "@/lib/config/app-config";
import { getContactNameMap } from "@/lib/data/contact-names";
import { getDadosClienteNameMap } from "@/lib/data/dados-cliente-names";
import { getIaConfig, normalizarTelefone } from "@/lib/ia-whatsapp/config";
import {
  AtendimentosPanel,
  type CasoMetaMap,
  type IaInfo,
} from "@/components/atendimentos/atendimentos-ui";
import { phoneToContactNorm } from "@/lib/utils/phone";

export default async function AtendimentosPage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>;
}) {
  const { contact } = await searchParams;
  const supabase = await createClient();

  const [
    conversasRes,
    etiquetasRes,
    contactNames,
    dadosClienteNames,
    whatsappInstancia,
    casosRes,
    iaConfig,
  ] = await Promise.all([
    supabase.rpc("listar_conversas", { p_limite: 1000 }),
    supabase.from("app_etiquetas").select("*").order("ordem").order("id"),
    getContactNameMap(supabase),
    getDadosClienteNameMap(),
    getWhatsAppInstancia(contact ?? undefined),
    supabase
      .from("casos_novos")
      .select("id, telefone, status, beneficio_identificado, cpf")
      .order("updated_at", { ascending: false }),
    getIaConfig().catch(() => null),
  ]);

  const allContactNames = { ...dadosClienteNames, ...contactNames };

  const casoMeta: CasoMetaMap = {};
  for (const row of casosRes.data ?? []) {
    const key = phoneToContactNorm(row.telefone);
    if (!key || casoMeta[key]) continue;
    casoMeta[key] = {
      id: row.id,
      status: row.status,
      beneficio: row.beneficio_identificado,
      cpf: row.cpf,
    };
  }

  const ia: IaInfo = {
    modo: iaConfig?.modo ?? "desligado",
    numerosTeste: (iaConfig?.numeros_teste ?? []).map(normalizarTelefone),
  };

  return (
    <div className="flex h-[calc(100dvh-9.5rem)] min-h-0 flex-col overflow-hidden">
      <AtendimentosPanel
        initialConversas={conversasRes.data ?? []}
        initialEtiquetas={etiquetasRes.data ?? []}
        initialContact={contact ?? null}
        contactNames={allContactNames}
        whatsappInstancia={whatsappInstancia}
        casoMeta={casoMeta}
        ia={ia}
      />
    </div>
  );
}
