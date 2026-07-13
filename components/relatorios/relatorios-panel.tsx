"use client";

import { useMemo } from "react";
import Papa from "papaparse";
import { FileBarChart, Download } from "lucide-react";
import type { Tables } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

type Caso = Tables<"casos_novos">;
type Processo = Tables<"processos_clientes">;

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function RelatoriosPanel({
  casos,
  processos,
}: {
  casos: Caso[];
  processos: Processo[];
}) {
  const mesAtual = format(new Date(), "MMMM yyyy", { locale: ptBR });
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const relatorioMensal = useMemo(() => {
    const casosMes = casos.filter(
      (c) => c.created_at && new Date(c.created_at) >= inicioMes
    );
    const convertidos = casosMes.filter((c) => c.status === "processo_finalizado");
    const emAbertura = casos.filter((c) => c.status === "abertura_processo");

    const tempos = emAbertura
      .filter((c) => c.created_at && c.updated_at)
      .map(
        (c) =>
          (new Date(c.updated_at!).getTime() - new Date(c.created_at!).getTime()) /
          (1000 * 60 * 60 * 24)
      );

    const tempoMedio =
      tempos.length > 0
        ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length)
        : 0;

    return {
      entradas: casosMes.length,
      convertidos: convertidos.length,
      tempoMedio,
    };
  }, [casos, inicioMes]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileBarChart className="h-5 w-5" />
            Relatório mensal — {mesAtual}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">Casos que entraram</p>
            <p className="text-3xl font-bold">{relatorioMensal.entradas}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Viraram processo</p>
            <p className="text-3xl font-bold">{relatorioMensal.convertidos}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Tempo médio abertura (dias)</p>
            <p className="text-3xl font-bold">{relatorioMensal.tempoMedio}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exportar dados</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                "casos_novos.csv",
                casos.map((c) => ({
                  id: c.id,
                  nome: c.nome,
                  cpf: c.cpf,
                  beneficio: c.beneficio_identificado,
                  status: c.status,
                  criado_em: c.created_at,
                }))
              )
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar casos (CSV)
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                "processos_clientes.csv",
                processos.map((p) => ({
                  id: p.id,
                  nome: p.nome,
                  cpf: p.cpf,
                  processo: p.numero_processo,
                  tribunal: p.tribunal,
                  ativo: p.ativo,
                }))
              )
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar processos (CSV)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
