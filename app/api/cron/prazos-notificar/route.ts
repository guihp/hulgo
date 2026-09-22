import { NextRequest, NextResponse } from "next/server";
import { processarLembretesPrazos } from "@/lib/prazos/notificar";

export const dynamic = "force-dynamic";

/**
 * Alertas de prazos — somente lembretes configurados em app_prazos_lembretes.
 *
 * Deadline: data_prazo + hora_prazo em America/Sao_Paulo
 * (hora_prazo null = legado 23:59:59 SP).
 * fire_at = deadline - offset_minutes (offset 0 = na hora).
 * Dedupe: app_prazos_alertas (tipo=lembrete, lembrete_id único).
 *
 * Agendar no Coolify a cada 5–15 min:
 *   * /5 * * * * curl -s -H "x-cron-secret: $CRON_SECRET" https://SEU-DOMINIO/api/cron/prazos-notificar
 *
 * (Hoje/amanhã automáticos e lembrar_em pontual foram descontinuados.)
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
    const result = await processarLembretesPrazos();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao notificar" },
      { status: 500 }
    );
  }
}

export const POST = GET;
