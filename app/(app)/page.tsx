import { createClient } from "@/lib/supabase/server";
import { DashboardHome, type DashboardPayload } from "@/components/dashboard/dashboard-home";
import { CASO_STATUS } from "@/lib/constants";
import { subDays, format } from "date-fns";

function sparklineFromMap(map: Record<string, number>, days = 7): number[] {
  return Array.from({ length: days }, (_, i) => {
    const d = subDays(new Date(), days - 1 - i);
    const key = format(d, "yyyy-MM-dd");
    return map[key] ?? 0;
  });
}

function weekDelta(map: Record<string, number>): number {
  const thisWeek = Array.from({ length: 7 }, (_, i) => {
    const key = format(subDays(new Date(), 6 - i), "yyyy-MM-dd");
    return map[key] ?? 0;
  }).reduce((a, b) => a + b, 0);
  const prevWeek = Array.from({ length: 7 }, (_, i) => {
    const key = format(subDays(new Date(), 13 - i), "yyyy-MM-dd");
    return map[key] ?? 0;
  }).reduce((a, b) => a + b, 0);
  if (prevWeek === 0) return thisWeek > 0 ? 100 : 0;
  return Math.round(((thisWeek - prevWeek) / prevWeek) * 100);
}

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  CASO_STATUS.map((s) => [s.value, s.label])
);

async function getDashboardData(): Promise<DashboardPayload> {
  const supabase = await createClient();

  const em7dias = format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), "yyyy-MM-dd");

  const [
    casosRes,
    aprovacoesRes,
    processosRes,
    mensagensRes,
    casosRecentesRes,
    aprovacoesRecentesRes,
    prazosRes,
  ] = await Promise.all([
    supabase.from("casos_novos").select("id, status, beneficio_identificado, created_at, updated_at"),
    supabase.from("aprovacoes_pendentes").select("id, status, created_at"),
    supabase.from("processos_clientes").select("id, ativo, created_at"),
    supabase.from("mensagens").select("contact_norm, created_at").order("created_at", { ascending: false }),
    supabase
      .from("casos_novos")
      .select("id, nome, status, created_at, beneficio_identificado")
      .in("status", [
        "em_atendimento",
        "consultar_processo",
        "abertura_processo",
        "aguardando_analise",
        "aguardando_aprovacao",
        "atendimento_humano",
      ])
      .order("updated_at", { ascending: false })
      .limit(15),
    supabase
      .from("aprovacoes_pendentes")
      .select("id, nome_cliente, status, created_at")
      .eq("status", "pendente")
      .order("created_at", { ascending: true })
      .limit(10),
    supabase
      .from("app_prazos")
      .select("id, titulo, tipo, data_prazo, hora_prazo, caso_id")
      .eq("concluido", false)
      .lte("data_prazo", em7dias)
      .order("data_prazo", { ascending: true })
      .limit(10),
  ]);

  const casos = casosRes.data ?? [];
  const aprovacoes = aprovacoesRes.data ?? [];
  const processos = processosRes.data ?? [];
  const mensagens = mensagensRes.data ?? [];

  const casosEmAtendimento = casos.filter((c) => c.status === "em_atendimento").length;
  const aprovacoesPendentes = aprovacoes.filter((a) => a.status === "pendente").length;
  const processosAtivos = processos.filter((p) => p.ativo).length;
  const processosViaTriagem = casos.filter((c) => c.status === "processo_finalizado").length;

  const oneDayAgo = subDays(new Date(), 1).toISOString();
  const activeContacts = new Set(
    mensagens
      .filter((m) => m.created_at >= oneDayAgo && m.contact_norm)
      .map((m) => m.contact_norm)
  );

  const last30 = subDays(new Date(), 30);
  const casosPorDia: Record<string, number> = {};
  const aprovPorDia: Record<string, number> = {};
  const processosPorDia: Record<string, number> = {};
  const finalizadosPorDia: Record<string, number> = {};
  const conversasPorDia: Record<string, number> = {};

  casos.forEach((c) => {
    if (!c.created_at) return;
    const d = new Date(c.created_at);
    if (d < last30) return;
    const key = format(d, "yyyy-MM-dd");
    casosPorDia[key] = (casosPorDia[key] ?? 0) + 1;
    if (c.status === "processo_finalizado") {
      finalizadosPorDia[key] = (finalizadosPorDia[key] ?? 0) + 1;
    }
  });

  aprovacoes.forEach((a) => {
    if (!a.created_at) return;
    const d = new Date(a.created_at);
    if (d < last30) return;
    const key = format(d, "yyyy-MM-dd");
    aprovPorDia[key] = (aprovPorDia[key] ?? 0) + 1;
  });

  processos.forEach((p) => {
    if (!p.created_at) return;
    const d = new Date(p.created_at);
    if (d < last30) return;
    const key = format(d, "yyyy-MM-dd");
    processosPorDia[key] = (processosPorDia[key] ?? 0) + 1;
  });

  mensagens.forEach((m) => {
    if (!m.created_at || !m.contact_norm) return;
    const d = new Date(m.created_at);
    if (d < last30) return;
    const key = format(d, "yyyy-MM-dd");
    conversasPorDia[key] = (conversasPorDia[key] ?? 0) + 1;
  });

  const emAtendimentoPorDia: Record<string, number> = {};
  casos
    .filter((c) => c.status === "em_atendimento" && c.updated_at)
    .forEach((c) => {
      const key = format(new Date(c.updated_at!), "yyyy-MM-dd");
      emAtendimentoPorDia[key] = (emAtendimentoPorDia[key] ?? 0) + 1;
    });

  const funil = CASO_STATUS.map((s) => ({
    status: s.label,
    count: casos.filter((c) => c.status === s.value).length,
  }));

  const beneficioMap: Record<string, number> = {};
  casos.forEach((c) => {
    const b = c.beneficio_identificado ?? "Não identificado";
    beneficioMap[b] = (beneficioMap[b] ?? 0) + 1;
  });

  const beneficios = Object.entries(beneficioMap).map(([name, value]) => ({
    name: name.length > 30 ? name.slice(0, 30) + "…" : name,
    value,
  }));

  const acaoStatuses = new Set([
    "em_atendimento",
    "aguardando_aprovacao",
    "atendimento_humano",
    "aguardando_analise",
    "consultar_processo",
    "abertura_processo",
  ]);

  const acaoImediata = [
    ...(aprovacoesRecentesRes.data ?? []).map((a) => ({
      id: `ap-${a.id}`,
      tipo: "aprovacao" as const,
      titulo: a.nome_cliente ?? "Cliente",
      href: `/aprovacoes/${a.id}`,
      quando: a.created_at,
    })),
    ...(casosRecentesRes.data ?? [])
      .filter((c) => c.status != null && acaoStatuses.has(c.status))
      .map((c) => ({
        id: `cn-${c.id}`,
        tipo: "caso" as const,
        titulo: c.nome ?? "Caso sem nome",
        subtitulo: STATUS_LABEL[c.status!] ?? c.status ?? "Pendência",
        href: `/kanban/${c.id}`,
        quando: c.created_at,
      })),
  ]
    .sort(
      (a, b) =>
        new Date(a.quando ?? 0).getTime() - new Date(b.quando ?? 0).getTime()
    )
    .slice(0, 12);

  return {
    kpis: {
      casosEmAtendimento,
      aprovacoesPendentes,
      processosAtivos,
      processosViaTriagem,
      conversasAtivas: activeContacts.size,
    },
    kpiMeta: {
      casosEmAtendimento: {
        sparkline: sparklineFromMap(emAtendimentoPorDia),
        delta: weekDelta(emAtendimentoPorDia),
      },
      aprovacoesPendentes: {
        sparkline: sparklineFromMap(aprovPorDia),
        delta: weekDelta(aprovPorDia),
      },
      processosAtivos: {
        sparkline: sparklineFromMap(processosPorDia),
        delta: weekDelta(processosPorDia),
      },
      processosViaTriagem: {
        sparkline: sparklineFromMap(finalizadosPorDia),
        delta: weekDelta(finalizadosPorDia),
      },
      conversasAtivas: {
        sparkline: sparklineFromMap(conversasPorDia),
        delta: weekDelta(conversasPorDia),
      },
    },
    charts: { casosPorDia, aprovPorDia, funil, beneficios },
    acaoImediata,
    prazosSemana: prazosRes.data ?? [],
  };
}

export default async function DashboardPage() {
  const data = await getDashboardData();
  const updatedAt = format(new Date(), "HH:mm");
  return <DashboardHome data={data} updatedAt={updatedAt} />;
}
