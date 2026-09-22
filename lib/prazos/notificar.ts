import { createServiceClient } from "@/lib/supabase/service";
import { emitPainelPush } from "@/lib/push";
import {
  fireAtFromPrazo,
  formatPrazoDateTime,
  labelForOffset,
} from "@/lib/prazos/lembretes";

export type LembreteNotificarResultado = {
  id: number;
  lembrete_id: number;
  resultado: string;
  titulo?: string;
  quando?: string;
};

export type ProcessarLembretesResult = {
  ok: true;
  hoje: string;
  agoraIso: string;
  candidatos: number;
  enviados: number;
  relatorio: LembreteNotificarResultado[];
};

let processarInFlight: Promise<ProcessarLembretesResult> | null = null;

/**
 * Dispara Web Push para lembretes vencidos (fire_at <= agora).
 * Dedupe em app_prazos_alertas por lembrete_id.
 * Single-flight: chamadas concorrentes compartilham a mesma Promise.
 */
export async function processarLembretesPrazos(): Promise<ProcessarLembretesResult> {
  if (processarInFlight) return processarInFlight;
  processarInFlight = processarLembretesPrazosInner().finally(() => {
    processarInFlight = null;
  });
  return processarInFlight;
}

async function processarLembretesPrazosInner(): Promise<ProcessarLembretesResult> {
  const service = createServiceClient();
  const agora = new Date();

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const hojeSp = fmt.format(agora);

  const relatorio: LembreteNotificarResultado[] = [];
  let enviados = 0;
  let candidatos = 0;

  const { data: prazosAbertos, error: errPrazos } = await service
    .from("app_prazos")
    .select("id, titulo, data_prazo, hora_prazo")
    .eq("concluido", false);

  if (errPrazos) {
    throw new Error(errPrazos.message);
  }

  const abertos = prazosAbertos ?? [];
  if (!abertos.length) {
    return {
      ok: true,
      hoje: hojeSp,
      agoraIso: agora.toISOString(),
      candidatos: 0,
      enviados: 0,
      relatorio: [],
    };
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
    throw new Error(errLemb.message);
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

    // Se o push não saiu, remove o dedupe para o próximo tick/cron tentar de novo.
    if (result.skipped || result.sent === 0) {
      await service
        .from("app_prazos_alertas")
        .delete()
        .eq("lembrete_id", row.id)
        .eq("tipo", "lembrete");
      relatorio.push({
        id: prazo.id,
        lembrete_id: row.id,
        titulo: prazo.titulo,
        quando,
        resultado: result.skipped
          ? "vapid skip (sem dedupe)"
          : `push sent=0 (sem dedupe) removed=${result.removed}`,
      });
      continue;
    }

    enviados += result.sent;
    relatorio.push({
      id: prazo.id,
      lembrete_id: row.id,
      titulo: prazo.titulo,
      quando,
      resultado: `push sent=${result.sent} removed=${result.removed}`,
    });
  }

  return {
    ok: true,
    hoje: hojeSp,
    agoraIso: agora.toISOString(),
    candidatos,
    enviados,
    relatorio,
  };
}
