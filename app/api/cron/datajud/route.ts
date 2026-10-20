import { NextRequest, NextResponse } from "next/server";
import { executarRodadaDataJud } from "@/lib/datajud-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Consulta automática do DataJud/CNJ — todos os processos ativos com nº CNJ,
 * uma vez por dia cada (ver docs/RECONSULTA-E-ASSINATURA.md).
 * Agendar DE HORA EM HORA: consulta em lotes de 20 por tribunal; se o CNJ estiver
 * lento ou recusar, para em até ~4,5 min e o que sobrou fica para a próxima
 * execução. Quando não há nada vencido, volta na hora.
 *   0 * * * * curl -s -H "x-cron-secret: $CRON_SECRET" https://SEU-DOMINIO/api/cron/datajud
 * Movimentação nova atualiza o card do processo e, se ligado em Configurações →
 * Consulta na Justiça, vira pendência em /aprovacoes.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const provided =
    req.headers.get("x-cron-secret") ??
    req.nextUrl.searchParams.get("secret") ??
    "";
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const resultado = await executarRodadaDataJud({ orcamentoMs: 270_000 });
    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Falha na consulta automática" },
      { status: 500 }
    );
  }
}

export const POST = GET;
