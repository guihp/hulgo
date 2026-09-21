import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { emitPainelPush } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Alerta diário de prazos vencendo hoje e amanhã.
 * Agendar no Coolify (Scheduled Task) — ver docs/DEPLOY-COOLIFY.md:
 *   0 7 * * * curl -s -H "x-cron-secret: $CRON_SECRET" https://SEU-DOMINIO/api/cron/prazos-notificar
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

  const service = createServiceClient();

  // Usa fuso America/Sao_Paulo para “hoje/amanhã”
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const hoje = fmt.format(new Date()); // yyyy-mm-dd
  // Meio-dia BRT evita edge de DST ao somar 1 dia
  const amanhaParts = new Date(`${hoje}T12:00:00-03:00`);
  amanhaParts.setDate(amanhaParts.getDate() + 1);
  const amanha = fmt.format(amanhaParts);

  const { data: prazos, error } = await service
    .from("app_prazos")
    .select("id, titulo, data_prazo, tipo")
    .eq("concluido", false)
    .in("data_prazo", [hoje, amanha]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const relatorio: { id: number; tipo: string; resultado: string }[] = [];
  let enviados = 0;

  for (const p of prazos ?? []) {
    const tipoAlerta = p.data_prazo === hoje ? "hoje" : "amanha";
    const alertaDia = hoje;

    const { error: dedupeErr } = await service
      .from("app_prazos_alertas")
      .insert({
        prazo_id: p.id,
        alerta_dia: alertaDia,
        tipo: tipoAlerta,
      });

    if (dedupeErr) {
      // unique violation → já notificado hoje
      if (dedupeErr.code === "23505") {
        relatorio.push({
          id: p.id,
          tipo: tipoAlerta,
          resultado: "já notificado",
        });
        continue;
      }
      relatorio.push({
        id: p.id,
        tipo: tipoAlerta,
        resultado: `dedupe erro: ${dedupeErr.message}`,
      });
      continue;
    }

    const tituloPush =
      tipoAlerta === "hoje" ? "⏰ Prazo vence hoje" : "📅 Prazo vence amanhã";
    const result = await emitPainelPush({
      kind: "prazo",
      title: tituloPush,
      body: `${p.titulo} (${p.data_prazo})`,
      href: "/prazos",
      tag: `prazo-alerta-${p.id}-${alertaDia}-${tipoAlerta}`,
    });

    enviados += result.sent;
    relatorio.push({
      id: p.id,
      tipo: tipoAlerta,
      resultado: result.skipped
        ? "vapid skip"
        : `push sent=${result.sent} removed=${result.removed}`,
    });
  }

  return NextResponse.json({
    ok: true,
    hoje,
    amanha,
    candidatos: prazos?.length ?? 0,
    enviados,
    relatorio,
  });
}

export const POST = GET;
