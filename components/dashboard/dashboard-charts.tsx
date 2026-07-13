"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, subDays } from "date-fns";

type ChartData = {
  casosPorDia: Record<string, number>;
  aprovPorDia: Record<string, number>;
  funil: { status: string; count: number }[];
  beneficios: { name: string; value: number }[];
  tempoMedio: { etapa: string; dias: number }[];
};

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444"];

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    color: "var(--foreground)",
  },
  labelStyle: { color: "var(--foreground)" },
};

function buildDailySeries(
  casos: Record<string, number>,
  aprov: Record<string, number>,
  days: number
) {
  return Array.from({ length: days }, (_, i) => {
    const d = subDays(new Date(), days - 1 - i);
    const key = format(d, "yyyy-MM-dd");
    return {
      data: format(d, "dd/MM"),
      casos: casos[key] ?? 0,
      aprovacoes: aprov[key] ?? 0,
    };
  });
}

function hasSeriesData(series: { casos: number; aprovacoes: number }[]) {
  return series.some((s) => s.casos > 0 || s.aprovacoes > 0);
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export function DashboardCharts({ data }: { data: ChartData }) {
  const series14 = buildDailySeries(data.casosPorDia, data.aprovPorDia, 14);
  const series30 = buildDailySeries(data.casosPorDia, data.aprovPorDia, 30);
  const funilTotal = data.funil.reduce((acc, f) => acc + f.count, 0);
  const beneficiosTotal = data.beneficios.reduce((acc, b) => acc + b.value, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-border/80 shadow-sm lg:col-span-2">
        <CardHeader>
          <CardTitle>Entradas por dia</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="14">
            <TabsList>
              <TabsTrigger value="14">14 dias</TabsTrigger>
              <TabsTrigger value="30">30 dias</TabsTrigger>
            </TabsList>
            <TabsContent value="14" className="h-72">
              {!hasSeriesData(series14) ? (
                <EmptyChart message="Sem entradas nos últimos 14 dias" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series14}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
                    <XAxis dataKey="data" fontSize={12} stroke="var(--muted-foreground)" />
                    <YAxis allowDecimals={false} fontSize={12} stroke="var(--muted-foreground)" />
                    <Tooltip {...tooltipStyle} />
                    <Legend />
                    <Line type="monotone" dataKey="casos" name="Casos novos" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="aprovacoes" name="Aprovações" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </TabsContent>
            <TabsContent value="30" className="h-72">
              {!hasSeriesData(series30) ? (
                <EmptyChart message="Sem entradas nos últimos 30 dias" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series30}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
                    <XAxis dataKey="data" fontSize={12} stroke="var(--muted-foreground)" />
                    <YAxis allowDecimals={false} fontSize={12} stroke="var(--muted-foreground)" />
                    <Tooltip {...tooltipStyle} />
                    <Legend />
                    <Line type="monotone" dataKey="casos" name="Casos novos" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="aprovacoes" name="Aprovações" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle>Funil de casos</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {funilTotal === 0 ? (
            <EmptyChart message="Nenhum caso no funil" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.funil} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
                <XAxis type="number" allowDecimals={false} fontSize={12} stroke="var(--muted-foreground)" />
                <YAxis type="category" dataKey="status" width={120} fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="count" name="Casos" fill={CHART_COLORS[2]} radius={4} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle>Benefícios identificados</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {beneficiosTotal === 0 ? (
            <EmptyChart message="Nenhum benefício identificado" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.beneficios}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  outerRadius={80}
                >
                  {data.beneficios.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} />
                <Legend layout="horizontal" verticalAlign="bottom" />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm lg:col-span-2">
        <CardHeader>
          <CardTitle>Tempo médio por etapa (dias)</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          {data.tempoMedio.every((t) => t.dias === 0) ? (
            <EmptyChart message="Dados insuficientes para calcular tempos" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.tempoMedio}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
                <XAxis dataKey="etapa" fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis allowDecimals={false} fontSize={12} stroke="var(--muted-foreground)" />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="dias" name="Dias" fill={CHART_COLORS[3]} radius={4} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
