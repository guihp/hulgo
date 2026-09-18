import { NextRequest, NextResponse } from "next/server";
import { limparSandboxAntigo } from "@/lib/agente/sandbox-cleanup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Remove sessões/mensagens/mídia do sandbox do agente com mais de 7 dias.
 * Agendar na VPS (crontab) ou Coolify Scheduled Task:
 *   0 3 * * * curl -s -H "x-cron-secret: $CRON_SECRET" https://SEU-DOMINIO/api/cron/agente-sandbox
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
    const result = await limparSandboxAntigo();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao limpar sandbox";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = GET;
