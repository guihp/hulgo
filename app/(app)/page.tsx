import Link from "next/link";
import {
  Kanban,
  CheckCircle,
  Users,
  MessageSquare,
  GitBranch,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { DashboardCharts } from "@/components/dashboard/dashboard-charts";
import { formatRelative } from "@/lib/utils/dates";
import { CASO_STATUS } from "@/lib/constants";
import { subDays, format } from "date-fns";

async function getDashboardData() {
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
    supabase.from("processos_clientes").select("id, ativo"),
    supabase.from("mensagens").select("contact_norm, created_at").order("created_at", { ascending: false }),
    supabase.from("casos_novos").select("id, nome, status, created_at, beneficio_identificado")
      .in("status", ["em_atendimento", "consultar_processo", "abertura_processo", "aguardando_aprovacao", "atendimento_humano"])
      .order("created_at", { ascending: true })
      .limit(10),
    supabase.from("aprovacoes_pendentes").select("id, nome_cliente, status, created_at")
      .eq("status", "pendente")
      .order("created_at", { ascending: true })
      .limit(10),
    supabase.from("app_prazos").select("id, titulo, tipo, data_prazo, caso_id")
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

  casos.forEach((c) => {
    if (!c.created_at) return;
    const d = new Date(c.created_at);
    if (d < last30) return;
    const key = format(d, "yyyy-MM-dd");
    casosPorDia[key] = (casosPorDia[key] ?? 0) + 1;
  });

  aprovacoes.forEach((a) => {
    if (!a.created_at) return;
    const d = new Date(a.created_at);
    if (d < last30) return;
    const key = format(d, "yyyy-MM-dd");
    aprovPorDia[key] = (aprovPorDia[key] ?? 0) + 1;
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

  const tempoMedio = CASO_STATUS.slice(0, -1).map((s) => {
    const subset = casos.filter((c) => c.status === s.value && c.created_at && c.updated_at);
    if (!subset.length) return { etapa: s.label, dias: 0 };
    const avg =
      subset.reduce((acc, c) => {
        const diff =
          (new Date(c.updated_at!).getTime() - new Date(c.created_at!).getTime()) /
          (1000 * 60 * 60 * 24);
        return acc + diff;
      }, 0) / subset.length;
    return { etapa: s.label, dias: Math.round(avg) };
  });

  const acaoImediata = [
    ...(aprovacoesRecentesRes.data ?? []).map((a) => ({
      id: `ap-${a.id}`,
      tipo: "aprovacao" as const,
      titulo: a.nome_cliente ?? "Cliente",
      href: `/aprovacoes/${a.id}`,
      quando: a.created_at,
    })),
    ...(casosRecentesRes.data ?? [])
      .filter((c) => c.status === "em_atendimento")
      .map((c) => ({
        id: `cn-${c.id}`,
        tipo: "caso" as const,
        titulo: c.nome ?? "Caso sem nome",
        href: `/kanban/${c.id}`,
        quando: c.created_at,
      })),
  ].sort((a, b) => new Date(a.quando ?? 0).getTime() - new Date(b.quando ?? 0).getTime());

  return {
    kpis: {
      casosEmAtendimento,
      aprovacoesPendentes,
      processosAtivos,
      processosViaTriagem,
      conversasAtivas: activeContacts.size,
    },
    charts: { casosPorDia, aprovPorDia, funil, beneficios, tempoMedio },
    acaoImediata,
    prazosSemana: prazosRes.data ?? [],
  };
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  const kpiCards = [
    { label: "Em atendimento", value: data.kpis.casosEmAtendimento, href: "/kanban", icon: Kanban, color: "text-blue-600 dark:text-blue-400" },
    { label: "Aprovações pendentes", value: data.kpis.aprovacoesPendentes, href: "/aprovacoes", icon: CheckCircle, color: "text-amber-600 dark:text-amber-400" },
    { label: "Processos ativos", value: data.kpis.processosAtivos, href: "/clientes", icon: Users, color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Finalizados (triagem)", value: data.kpis.processosViaTriagem, href: "/kanban", icon: GitBranch, color: "text-violet-600 dark:text-violet-400" },
    { label: "Conversas ativas (24h)", value: data.kpis.conversasAtivas, href: "/atendimentos", icon: MessageSquare, color: "text-primary" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral do escritório</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Link key={kpi.label} href={kpi.href}>
              <Card className="border-border/80 shadow-sm transition-colors hover:bg-muted/40">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {kpi.label}
                  </CardTitle>
                  <Icon className={`h-4 w-4 ${kpi.color}`} />
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold tracking-tight">{kpi.value}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <DashboardCharts data={data.charts} />

      <Card className={data.prazosSemana.length > 0 ? "border-amber-500/50" : undefined}>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Prazos dos próximos 7 dias</CardTitle>
          <LinkButton href="/prazos" size="sm" variant="outline">
            Ver todos
          </LinkButton>
        </CardHeader>
        <CardContent>
          {data.prazosSemana.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum prazo vencendo nesta semana.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.prazosSemana.map((p) => {
                const vencido = p.data_prazo < format(new Date(), "yyyy-MM-dd");
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.titulo}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.data_prazo + "T12:00:00").toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <Badge variant={vencido ? "destructive" : "outline"}>
                      {vencido ? "vencido" : "próximo"}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exige ação agora</CardTitle>
        </CardHeader>
        <CardContent>
          {data.acaoImediata.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma pendência urgente. Boa notícia!
            </p>
          ) : (
            <ul className="space-y-3">
              {data.acaoImediata.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant={item.tipo === "aprovacao" ? "destructive" : "default"}>
                        {item.tipo === "aprovacao" ? "Aprovação" : "Caso novo"}
                      </Badge>
                      <span className="font-medium">{item.titulo}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatRelative(item.quando)}
                    </p>
                  </div>
                  <LinkButton href={item.href} size="sm" variant="outline">
                    Abrir
                  </LinkButton>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
