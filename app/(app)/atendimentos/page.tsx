import { createClient } from "@/lib/supabase/server";
import { getWhatsAppInstancia } from "@/lib/config/app-config";
import { getContactNameMap } from "@/lib/data/contact-names";
import { getDadosClienteNameMap } from "@/lib/data/dados-cliente-names";
import { getIaConfig, normalizarTelefone } from "@/lib/ia-whatsapp/config";
import {
  AtendimentosPanel,
  type CasoMetaMap,
  type IaInfo,
  type ParceiroMetaMap,
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
    processosRes,
    parceirosRes,
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
    supabase
      .from("processos_clientes")
      .select("telefone, cpf, caso_id, parceiro_id")
      .not("parceiro_id", "is", null),
    supabase.from("app_parceiros").select("id, nome"),
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

  // Etiqueta do parceiro: processo ligado ao contato pelo telefone, pelo card do
  // funil (caso_id) ou pelo CPF do card.
  const parceiroNome = new Map((parceirosRes.data ?? []).map((p) => [p.id, p.nome]));
  const casoPorId = new Map((casosRes.data ?? []).map((c) => [c.id, c]));
  const contatosPorCpf = new Map<string, string[]>();
  for (const c of casosRes.data ?? []) {
    const cpf = c.cpf?.replace(/\D/g, "");
    const key = phoneToContactNorm(c.telefone);
    if (cpf && key) contatosPorCpf.set(cpf, [...(contatosPorCpf.get(cpf) ?? []), key]);
  }
  const parceiroMeta: ParceiroMetaMap = {};
  for (const p of processosRes.data ?? []) {
    const nome = p.parceiro_id ? parceiroNome.get(p.parceiro_id) : null;
    if (!nome) continue;
    const contatos = new Set<string>();
    const tel = phoneToContactNorm(p.telefone);
    if (tel) contatos.add(tel);
    const casoTel = p.caso_id ? phoneToContactNorm(casoPorId.get(p.caso_id)?.telefone) : "";
    if (casoTel) contatos.add(casoTel);
    for (const k of contatosPorCpf.get(p.cpf?.replace(/\D/g, "") ?? "") ?? []) contatos.add(k);
    for (const k of contatos) {
      const lista = (parceiroMeta[k] ??= []);
      if (!lista.includes(nome)) lista.push(nome);
    }
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
        parceiroMeta={parceiroMeta}
        ia={ia}
      />
    </div>
  );
}
