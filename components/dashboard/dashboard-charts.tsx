"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";

type ChartData = {
  casosPorDia: Record<string, number>;
  aprovPorDia: Record<string, number>;
  funil: { status: string; count: number }[];
  beneficios: { name: string; value: number }[];
};

const NAVY = ["#0b2148", "#163a7a", "#2b62b8", "#5b8fd4", "#93c5fd"];
const NAVY_STROKE = "#163a7a";
const NAVY_DARK = "#0b2148";
const AMBER = "#f59e0b";

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "#ffffff",
    border: "1px solid rgba(11, 33, 72, 0.12)",
    borderRadius: "12px",
    color: "#0b2148",
    boxShadow: "0 12px 40px rgba(11, 33, 72, 0.08)",
  },
  labelStyle: { color: "#64748b" },
};

const cardShell =
  "rounded-2xl border border-[#e2e8f0] bg-white shadow-none ring-0";

function formatAxisDay(d: Date) {
  const raw = format(d, "dd MMM", { locale: ptBR });
  return raw.replace(/\./g, "").toLowerCase();
}

function buildDailySeries(
  casos: Record<string, number>,
  _aprov: Record<string, number>,
  days: number
) {
  return Array.from({ length: days }, (_, i) => {
    const d = subDays(new Date(), days - 1 - i);
    const key = format(d, "yyyy-MM-dd");
    return {
      data: formatAxisDay(d),
      casos: casos[key] ?? 0,
    };
  });
}

function hasCasosData(series: { casos: number }[]) {
  return series.some((s) => s.casos > 0);
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[#64748B]">
      {message}
    </div>
  );
}

const FUNIL_TRACK = "#e2e8f0";
const FUNIL_FILL = "#163a7a";

function funilBarFill(label: string): string {
  if (label === "Aguardando aprovação") return AMBER;
  return FUNIL_FILL;
}

function BeneficiosIdentificados({
  items,
  total,
}: {
  items: { name: string; value: number }[];
  total: number;
}) {
  return (
    <div className="flex h-[200px] items-center gap-3 sm:gap-4">
      <div className="relative h-[200px] min-w-[140px] flex-1 shrink-0 sm:min-w-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={items}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={46}
              outerRadius={72}
              paddingAngle={2}
              stroke="#ffffff"
              strokeWidth={2}
            >
              {items.map((_, i) => (
                <Cell key={i} fill={NAVY[i % NAVY.length]} />
              ))}
            </Pie>
            <Tooltip {...tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums leading-none text-[#0b2148] sm:text-3xl">
            {total}
          </span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#64748B]">
            CASOS
          </span>
        </div>
      </div>
      <ul className="flex min-w-0 flex-1 flex-col justify-center gap-2">
        {items.map((item, i) => (
          <li
            key={item.name}
            className="flex items-center gap-2 text-xs leading-tight sm:text-sm"
          >
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: NAVY[i % NAVY.length] }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate font-medium text-[#0F172A]">
              {item.name}
            </span>
            <span className="shrink-0 tabular-nums font-semibold text-[#0b2148]">
              {item.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FunilDeCasos({ rows }: { rows: { status: string; count: number }[] }) {
  const maxCount = Math.max(...rows.map((r) => r.count), 1);

  return (
    <div className="flex flex-col justify-start gap-3">
      {rows.map((row) => {
        const pct = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
        const fill = funilBarFill(row.status);

        return (
          <div key={row.status} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-[#0F172A]">
                {row.status}
              </span>
              <span className="shrink-0 tabular-nums font-semibold text-[#0b2148]">
                {row.count}
              </span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full"
              style={{ backgroundColor: FUNIL_TRACK }}
              role="progressbar"
              aria-valuenow={row.count}
              aria-valuemin={0}
              aria-valuemax={maxCount}
              aria-label={`${row.status}: ${row.count} casos`}
            >
              <div
                className="h-full rounded-full transition-[width] duration-300 ease-out"
                style={{
                  width: `${pct}%`,
                  backgroundColor: fill,
                  minWidth: row.count > 0 ? "0.5rem" : 0,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EntradasLastDot(props: {
  cx?: number;
  cy?: number;
  index?: number;
  lastIndex: number;
}) {
  const { cx, cy, index, lastIndex } = props;
  if (cx == null || cy == null || index !== lastIndex) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={10} fill={NAVY_STROKE} fillOpacity={0.18} />
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill={NAVY_DARK}
        stroke="#ffffff"
        strokeWidth={2}
      />
    </g>
  );
}

function EntradasPorDia({
  series,
  days,
}: {
  series: { data: string; casos: number }[];
  days: 14 | 30;
}) {
  const total = series.reduce((acc, s) => acc + s.casos, 0);
  const lastIndex = series.length - 1;

  return (
    <Card className={`${cardShell} lg:col-span-2`}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-[#0F172A]">Entradas por dia</CardTitle>
          <CardDescription className="text-[#64748B]">
            Novos atendimentos nos últimos {days} dias
          </CardDescription>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-3xl font-bold tabular-nums leading-none text-[#0b2148] sm:text-4xl">
            {total}
          </p>
          <p className="mt-1 text-xs font-medium text-[#64748B]">no período</p>
        </div>
      </CardHeader>
      <CardContent className="h-72">
        {!hasCasosData(series) ? (
          <EmptyChart message={`Sem entradas nos últimos ${days} dias`} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={series}
              margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="entradas-casos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={NAVY_STROKE} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={NAVY_STROKE} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(11,33,72,0.08)"
                vertical={false}
              />
              <XAxis
                dataKey="data"
                fontSize={12}
                stroke="#94a3b8"
                tickLine={false}
                axisLine={{ stroke: "rgba(11,33,72,0.08)" }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                fontSize={12}
                stroke="#94a3b8"
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip {...tooltipStyle} />
              <Area
                type="monotone"
                dataKey="casos"
                name="Casos novos"
                stroke={NAVY_STROKE}
                fill="url(#entradas-casos)"
                strokeWidth={2.5}
                activeDot={false}
                dot={(props) => (
                  <EntradasLastDot {...props} lastIndex={lastIndex} />
                )}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardCharts({
  data,
  days,
}: {
  data: ChartData;
  days: 14 | 30;
}) {
  const series = buildDailySeries(data.casosPorDia, data.aprovPorDia, days);
  const funilTotal = data.funil.reduce((acc, f) => acc + f.count, 0);
  const beneficiosTotal = data.beneficios.reduce((acc, b) => acc + b.value, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className={cardShell}>
        <CardHeader className="pb-2">
          <CardTitle className="text-[#0F172A]">Benefícios identificados</CardTitle>
          <CardDescription className="text-[#64748B]">
            Top categorias do período
          </CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          {beneficiosTotal === 0 ? (
            <EmptyChart message="Nenhum benefício identificado" />
          ) : (
            <BeneficiosIdentificados items={data.beneficios} total={beneficiosTotal} />
          )}
        </CardContent>
      </Card>

      <Card className={cardShell}>
        <CardHeader className="pb-2">
          <CardTitle className="text-[#0F172A]">Funil de casos</CardTitle>
          <CardDescription className="text-[#64748B]">
            Distribuição por etapa
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-72 overflow-y-auto pb-1 sm:overflow-visible sm:pb-4">
          {funilTotal === 0 ? (
            <EmptyChart message="Nenhum caso no funil" />
          ) : (
            <FunilDeCasos rows={data.funil} />
          )}
        </CardContent>
      </Card>

      <EntradasPorDia series={series} days={days} />
    </div>
  );
}
