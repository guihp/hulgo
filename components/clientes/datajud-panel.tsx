"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Gavel, Loader2, RefreshCw } from "lucide-react";
import {
  consultarProcessoDataJud,
  definirMonitoramento,
} from "@/lib/actions/datajud";
import type { ResultadoDataJud } from "@/lib/datajud";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { formatDate, formatDateTime } from "@/lib/utils/dates";

const MONITOR_OPCOES = [
  { value: "off", label: "Monitoramento: desligado" },
  { value: "1", label: "Reconsultar todo dia" },
  { value: "3", label: "Reconsultar a cada 3 dias" },
  { value: "7", label: "Reconsultar a cada 7 dias" },
  { value: "15", label: "Reconsultar a cada 15 dias" },
  { value: "30", label: "Reconsultar a cada 30 dias" },
];

export function DataJudPanel({
  numeroProcesso,
  processoId,
  monitorarDias,
  ultimaConsulta,
}: {
  numeroProcesso: string;
  processoId?: number;
  monitorarDias?: number | null;
  ultimaConsulta?: string | null;
}) {
  const router = useRouter();
  const [resultado, setResultado] = useState<ResultadoDataJud | null>(null);
  const [loading, setLoading] = useState(false);

  async function mudarMonitoramento(v: string | null) {
    if (!processoId) return;
    try {
      await definirMonitoramento(processoId, v && v !== "off" ? Number(v) : null);
      toast.success(
        v && v !== "off"
          ? `Monitoramento ligado: a cada ${v} dia(s), movimentação nova vira pendência de aprovação`
          : "Monitoramento desligado"
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  }

  async function consultar() {
    setLoading(true);
    try {
      const r = await consultarProcessoDataJud(numeroProcesso);
      setResultado(r);
      if (!r.encontrado) {
        toast.info(r.motivo, {
          duration: r.motivo.includes("Limite de consultas") ? 8000 : 5000,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na consulta");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gavel className="h-4 w-4" />
          Andamento processual (DataJud/CNJ)
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {processoId !== undefined && (
            <Select
              value={monitorarDias ? String(monitorarDias) : "off"}
              onValueChange={mudarMonitoramento}
            >
              <SelectTrigger className="h-8 w-56 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONITOR_OPCOES.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={consultar}
            disabled={loading}
            className="gap-2"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {resultado ? "Atualizar" : "Consultar agora"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!resultado && !loading && (
          <p className="text-sm text-muted-foreground">
            Consulta o processo{" "}
            <span className="font-mono text-xs">{numeroProcesso}</span> direto na
            API pública do CNJ.
            {monitorarDias
              ? ` Monitoramento automático a cada ${monitorarDias} dia(s)${
                  ultimaConsulta
                    ? ` — última consulta ${formatDateTime(ultimaConsulta)}`
                    : " — primeira consulta na próxima execução do robô"
                }.`
              : ""}
          </p>
        )}

        {resultado && !resultado.encontrado && (
          <p className="text-sm text-muted-foreground">{resultado.motivo}</p>
        )}

        {resultado?.encontrado && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{resultado.tribunal}</Badge>
              {resultado.grau && <Badge variant="outline">{resultado.grau}</Badge>}
              {resultado.classe && (
                <Badge variant="secondary">{resultado.classe}</Badge>
              )}
            </div>
            <div className="grid gap-1 text-muted-foreground sm:grid-cols-2">
              <span>
                Órgão julgador:{" "}
                <span className="text-foreground">
                  {resultado.orgaoJulgador ?? "—"}
                </span>
              </span>
              <span>
                Ajuizado em:{" "}
                <span className="text-foreground">
                  {formatDate(resultado.dataAjuizamento)}
                </span>
              </span>
              <span className="sm:col-span-2">
                Última atualização:{" "}
                <span className="text-foreground">
                  {formatDateTime(resultado.ultimaAtualizacao)}
                </span>
              </span>
            </div>
            {resultado.assuntos.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Assuntos: {resultado.assuntos.join(" · ")}
              </p>
            )}
            <Separator />
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Últimas movimentações
            </p>
            <ol className="space-y-2">
              {resultado.movimentos.map((m, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {formatDate(m.data)}
                  </span>
                  <span>
                    {m.nome}
                    {m.complemento && (
                      <span className="text-muted-foreground">
                        {" "}
                        — {m.complemento}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
