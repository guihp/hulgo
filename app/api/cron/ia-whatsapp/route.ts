import { NextRequest, NextResponse } from "next/server";
import { processarFilaIA } from "@/lib/ia-whatsapp/processar";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Varre a fila da IA do WhatsApp (pendências que o webhook não concluiu, ex.: deploy).
 *   * * * * * curl -s -H "x-cron-secret: $CRON_SECRET" https://SEU-DOMINIO/api/cron/ia-whatsapp
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const provided = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret") ?? "";
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await processarFilaIA()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}

export const POST = GET;
