import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { emitPainelPush } from "@/lib/push";
import {
  fireAtFromPrazo,
  formatPrazoDateTime,
  labelForOffset,
} from "@/lib/prazos/lembretes";

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

  const service = createServiceClient();
  const agora = new Date();

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const hojeSp = fmt.format(agora);

  const relatorio: { id: number; lembrete_id: number; resultado: string }[] =
    [];
  let enviados = 0;
  let candidatos = 0;

  const { data: prazosAbertos, error: errPrazos } = await service
    .from("app_prazos")
    .select("id, titulo, data_prazo, hora_prazo")
    .eq("concluido", false);

  if (errPrazos) {
    return NextResponse.json({ error: errPrazos.message }, { status: 500 });
  }

  const abertos = prazosAbertos ?? [];
  if (!abertos.length) {
    return NextResponse.json({
      ok: true,
      hoje: hojeSp,
      candidatos: 0,
      enviados: 0,
      relatorio: [],
    });
  }

  const prazoMap = new Map(abertos.map((p) => [p.id, p] as const));
  const { data: lembretes, error: errLemb } = await service
    .from("app_prazos_lembretes")
    .select("id, prazo_id, offset_minutes, label")
    .in(
      "prazo_id",
      abertos.map((p) => p.id)
    );

  if (errLemb) {
    return NextResponse.json({ error: errLemb.message }, { status: 500 });
  }

  for (const row of lembretes ?? []) {
    const prazo = prazoMap.get(row.prazo_id);
    if (!prazo) continue;

    const fireAt = fireAtFromPrazo(
      prazo.data_prazo,
      row.offset_minutes,
      prazo.hora_prazo
    );
    if (fireAt.getTime() > agora.getTime()) continue;

    candidatos += 1;

    const { error: dedupeErr } = await service.from("app_prazos_alertas").insert({
      prazo_id: prazo.id,
      alerta_dia: hojeSp,
      tipo: "lembrete",
      lembrete_id: row.id,
    });

    if (dedupeErr) {
      if (dedupeErr.code === "23505") {
        relatorio.push({
          id: prazo.id,
          lembrete_id: row.id,
          resultado: "já notificado",
        });
        continue;
      }
      relatorio.push({
        id: prazo.id,
        lembrete_id: row.id,
        resultado: `dedupe erro: ${dedupeErr.message}`,
      });
      continue;
    }

    const quando =
      row.label?.trim() || labelForOffset(row.offset_minutes);

    const result = await emitPainelPush({
      kind: "prazo",
      title: "🔔 Lembrete de prazo",
      body: `${prazo.titulo} — ${quando} (vence ${formatPrazoDateTime(prazo.data_prazo, prazo.hora_prazo)})`,
      href: "/prazos",
      tag: `prazo-lembrete-${row.id}`,
    });

    enviados += result.sent;
    relatorio.push({
      id: prazo.id,
      lembrete_id: row.id,
      resultado: result.skipped
        ? "vapid skip"
        : `push sent=${result.sent} removed=${result.removed}`,
    });
  }

  return NextResponse.json({
    ok: true,
    hoje: hojeSp,
    candidatos,
    enviados,
    relatorio,
  });
}

export const POST = GET;
