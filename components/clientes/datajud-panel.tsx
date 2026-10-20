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
import { toastErroAcao } from "@/lib/client/erros";

const MONITOR_OPCOES = [
  { value: "padrao", label: "Consulta automática: todo dia" },
  { value: "3", label: "Consulta automática: a cada 3 dias" },
  { value: "7", label: "Consulta automática: a cada 7 dias" },
  { value: "15", label: "Consulta automática: a cada 15 dias" },
  { value: "30", label: "Consulta automática: a cada 30 dias" },
  { value: "0", label: "Não consultar este processo" },
];

export type DataJudSalvo = {
  data: string | null;
  texto: string | null;
  resultado: string | null;
  novidadeEm: string | null;
};

/** Movimentação nova achada pela consulta automática nos últimos 7 dias. */
function novidadeRecente(iso: string | null): boolean {
  return Boolean(iso) && Date.now() - new Date(iso!).getTime() < 7 * 24 * 3600_000;
}

export function DataJudPanel({
  numeroProcesso,
  processoId,
  monitorarDias,
  ultimaConsulta,
  salvo,
}: {
  numeroProcesso: string;
  processoId?: number;
  monitorarDias?: number | null;
  ultimaConsulta?: string | null;
  salvo?: DataJudSalvo;
}) {
  const router = useRouter();
  const [resultado, setResultado] = useState<ResultadoDataJud | null>(null);
  const [loading, setLoading] = useState(false);

  async function mudarMonitoramento(v: string | null) {
    if (!processoId) return;
    try {
      await definirMonitoramento(processoId, v && v !== "padrao" ? Number(v) : null);
      toast.success(
        v === "0"
          ? "Este processo não será mais consultado automaticamente"
          : v && v !== "padrao"
            ? `Consulta automática a cada ${v} dias`
            : "Consulta automática todo dia"
      );
      router.refresh();
    } catch (err) {
      toastErroAcao(err, "Erro");
    }
  }

  async function consultar() {
    setLoading(true);
    try {
      const r = await consultarProcessoDataJud(numeroProcesso, processoId);
      setResultado(r);
      if (processoId) router.refresh();
      if (!r.encontrado) {
        toast.info(r.motivo, {
          duration: r.motivo.includes("Limite de consultas") ? 8000 : 5000,
        });
      }
    } catch (err) {
      toastErroAcao(err, "Erro na consulta");
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
              value={monitorarDias == null || monitorarDias === 1 ? "padrao" : String(monitorarDias)}
              onValueChange={mudarMonitoramento}
            >
              <SelectTrigger className="h-8 w-64 text-xs">
                <SelectValue>
                  {(v: string | null) => MONITOR_OPCOES.find((o) => o.value === v)?.label ?? ""}
                </SelectValue>
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
          <div className="space-y-2 text-sm">
            {salvo?.texto ? (
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Última movimentação na Justiça
                  {novidadeRecente(salvo.novidadeEm) ? (
                    <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">nova</Badge>
                  ) : null}
                </p>
                <p className="mt-1">
                  {salvo.data ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatDate(salvo.data)}{" "}
                    </span>
                  ) : null}
                  {salvo.texto}
                </p>
              </div>
            ) : salvo?.resultado && ultimaConsulta ? (
              <p className="text-muted-foreground">{salvo.resultado}</p>
            ) : null}
            <p className="text-muted-foreground">
              {monitorarDias === 0
                ? "Este processo está fora da consulta automática."
                : ultimaConsulta
                  ? `Consultado automaticamente na base do CNJ — última consulta ${formatDateTime(ultimaConsulta)}.`
                  : "Será consultado automaticamente na base do CNJ na próxima rodada."}{" "}
              Para ver a lista completa de movimentações, clique em Consultar agora.
            </p>
          </div>
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
