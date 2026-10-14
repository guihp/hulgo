import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/actions/auth";
import { getIaConfig, urlPainel } from "@/lib/ia-whatsapp/config";
import { createServiceClient } from "@/lib/supabase/service";
import { IaWhatsappUi } from "@/components/ia-whatsapp/ia-whatsapp-ui";

export const dynamic = "force-dynamic";

function seteDiasAtras() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

export default async function IaWhatsappPage() {
  const user = await getAppUser();
  if (!user) redirect("/login");
  if (user.papel !== "advogado") redirect("/");

  const supabase = createServiceClient();
  const seteDias = seteDiasAtras();

  const [config, pausados, fila, execucoes, semana, prompt] = await Promise.all([
    getIaConfig(),
    supabase
      .from("app_ia_estado")
      .select("telefone, nome_contato, pausada_em, pausada_motivo")
      .eq("pausada", true)
      .order("pausada_em", { ascending: false })
      .limit(100),
    supabase.from("app_ia_fila").select("*").order("processar_apos"),
    supabase
      .from("app_ia_execucoes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("app_ia_execucoes")
      .select("status, duracao_ms, ferramentas, telefone")
      .gte("created_at", seteDias)
      .limit(5000),
    supabase.from("app_agente_config").select("versao, persona_rascunho").eq("id", 1).maybeSingle(),
  ]);

  const linhas = semana.data ?? [];
  const respondidas = linhas.filter((l) => l.status === "ok");
  const ferramentasComErro = linhas.reduce((n, l) => {
    const lista = Array.isArray(l.ferramentas) ? (l.ferramentas as { erro?: string }[]) : [];
    return n + lista.filter((f) => f && typeof f === "object" && f.erro).length;
  }, 0);
  const estatisticas = {
    total: linhas.length,
    respondidas: respondidas.length,
    erros: linhas.filter((l) => l.status === "erro").length,
    conversas: new Set(linhas.map((l) => l.telefone)).size,
    tempoMedioS: respondidas.length
      ? Math.round(respondidas.reduce((s, l) => s + (l.duracao_ms ?? 0), 0) / respondidas.length / 1000)
      : 0,
    ferramentasComErro,
  };

  // Nomes dos contatos para o log
  const telefones = [...new Set((execucoes.data ?? []).map((e) => e.telefone))];
  const { data: nomes } = telefones.length
    ? await supabase.from("app_ia_estado").select("telefone, nome_contato").in("telefone", telefones)
    : { data: [] };

  return (
    <IaWhatsappUi
      config={config}
      webhookUrl={`${urlPainel()}/api/whatsapp/webhook?token=${config.webhook_token}`}
      cronUrl={`${urlPainel()}/api/cron/ia-whatsapp`}
      pausados={pausados.data ?? []}
      fila={fila.data ?? []}
      execucoes={execucoes.data ?? []}
      nomes={Object.fromEntries((nomes ?? []).map((n) => [n.telefone, n.nome_contato ?? ""]))}
      estatisticas={estatisticas}
      promptVersao={prompt.data?.versao ?? 0}
      temRascunho={Boolean(prompt.data?.persona_rascunho?.trim())}
    />
  );
}
