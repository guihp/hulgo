"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { Button } from "@/components/ui/button";
import { DashboardCharts } from "@/components/dashboard/dashboard-charts";
import { formatRelative } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

export type DashboardPayload = {
  kpis: {
    casosEmAtendimento: number;
    aprovacoesPendentes: number;
    processosAtivos: number;
    processosViaTriagem: number;
    conversasAtivas: number;
  };
  kpiMeta: {
    casosEmAtendimento: { sparkline: number[]; delta: number };
    aprovacoesPendentes: { sparkline: number[]; delta: number };
    processosAtivos: { sparkline: number[]; delta: number };
    processosViaTriagem: { sparkline: number[]; delta: number };
    conversasAtivas: { sparkline: number[]; delta: number };
  };
  charts: {
    casosPorDia: Record<string, number>;
    aprovPorDia: Record<string, number>;
    funil: { status: string; count: number }[];
    beneficios: { name: string; value: number }[];
  };
  acaoImediata: {
    id: string;
    tipo: "aprovacao" | "caso";
    titulo: string;
    subtitulo?: string;
    href: string;
    quando: string | null;
  }[];
  prazosSemana: {
    id: string | number;
    titulo: string;
    data_prazo: string;
  }[];
};

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function KpiSparkline({ data, color, id }: { data: number[]; color: string; id: string }) {
  const series = useMemo(
    () => data.map((value, i) => ({ i, value })),
    [data]
  );
  if (!series.some((d) => d.value > 0)) {
    return <div className="h-10" />;
  }
  const gradId = `spark-${id}`;
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="text-xs font-medium text-[#64748B]">— vs. sem. anterior</span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={cn(
        "text-xs font-semibold",
        up ? "text-emerald-600" : "text-rose-600"
      )}
    >
      {up ? "+" : ""}
      {delta}% vs. sem. anterior
    </span>
  );
}

const cardShell =
  "rounded-2xl border border-[#e2e8f0] bg-white shadow-none ring-0";

export function DashboardHome({
  data,
  updatedAt,
}: {
  data: DashboardPayload;
  updatedAt: string;
}) {
  const [chartDays, setChartDays] = useState<14 | 30>(14);

  const kpiCards = [
    {
      key: "casosEmAtendimento" as const,
      label: "Em atendimento",
      href: "/kanban",
      color: "#163a7a",
    },
    {
      key: "aprovacoesPendentes" as const,
      label: "Aprovações pendentes",
      href: "/aprovacoes",
      color: "#2b62b8",
    },
    {
      key: "processosAtivos" as const,
      label: "Processos ativos",
      href: "/clientes",
      color: "#0b2148",
    },
    {
      key: "processosViaTriagem" as const,
      label: "Finalizados (triagem)",
      href: "/kanban",
      color: "#5b8fd4",
    },
    {
      key: "conversasAtivas" as const,
      label: "Conversas ativas (24h)",
      href: "/atendimentos",
      color: "#163a7a",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">Dashboard</h1>
          <p className="text-sm text-[#64748B]">
            Atualizado hoje, {updatedAt}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-[#e2e8f0] bg-[#e2e8f0] p-0.5">
            {([14, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setChartDays(d)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                  chartDays === d
                    ? "bg-[#0b2148] text-white shadow-sm"
                    : "bg-[#F1F5F9] text-[#0F172A] hover:bg-white"
                )}
              >
                {d} dias
              </button>
            ))}
          </div>
          <Button
            render={<Link href="/atendimentos" />}
            className="rounded-full bg-[#0b2148] text-white shadow-[0_8px_24px_rgba(11,33,72,0.22)] hover:bg-[#163a7a]"
          >
            <Plus className="size-4" />
            Novo atendimento
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpiCards.map((kpi) => {
          const value = data.kpis[kpi.key];
          const meta = data.kpiMeta[kpi.key];
          return (
            <Link key={kpi.key} href={kpi.href} className="group block">
              <Card
                className={cn(
                  cardShell,
                  "transition-transform group-hover:-translate-y-0.5"
                )}
              >
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-semibold tracking-wide text-[#64748B] uppercase">
                    {kpi.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-end justify-between gap-2">
                    <p className="text-3xl font-bold tracking-tight text-[#0F172A]">
                      {value}
                    </p>
                    <DeltaBadge delta={meta.delta} />
                  </div>
                  <KpiSparkline data={meta.sparkline} color={kpi.color} id={kpi.key} />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <DashboardCharts data={data.charts} days={chartDays} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          className={cn(
            cardShell,
            data.prazosSemana.length > 0 && "border-amber-500/40"
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-[#0F172A]">Prazos dos próximos 7 dias</CardTitle>
            <LinkButton href="/prazos" size="sm" variant="outline">
              Ver todos
            </LinkButton>
          </CardHeader>
          <CardContent>
            {data.prazosSemana.length === 0 ? (
              <p className="text-sm text-[#64748B]">
                Nenhum prazo vencendo nesta semana.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.prazosSemana.map((p) => {
                  const vencido = p.data_prazo < format(new Date(), "yyyy-MM-dd");
                  return (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[#e2e8f0] p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[#0F172A]">
                          {p.titulo}
                        </p>
                        <p className="text-xs text-[#64748B]">
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

        <Card className={cardShell}>
          <CardHeader>
            <CardTitle className="text-[#0F172A]">Exige ação agora</CardTitle>
          </CardHeader>
          <CardContent>
            {data.acaoImediata.length === 0 ? (
              <p className="text-sm text-[#64748B]">
                Nenhuma pendência urgente. Boa notícia!
              </p>
            ) : (
              <ul className="space-y-3">
                {data.acaoImediata.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#e2e8f0] p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0b2148]/10 text-xs font-semibold text-[#0b2148]">
                        {initialsFromName(item.titulo)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              item.tipo === "aprovacao" ? "destructive" : "default"
                            }
                          >
                            {item.tipo === "aprovacao"
                              ? "Aprovação"
                              : item.subtitulo ?? "Pendência"}
                          </Badge>
                          <span className="truncate font-medium text-[#0F172A]">
                            {item.titulo}
                          </span>
                        </div>
                        <p className="text-xs text-[#64748B]">
                          {formatRelative(item.quando)}
                        </p>
                      </div>
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
    </div>
  );
}
