import { createServiceClient } from "@/lib/supabase/service";

const RETENTION_DAYS = 30;

/**
 * Removes assistente sessions (and cascaded messages) older than 30 days,
 * plus audit rows older than 30 days.
 */
export async function limparAssistenteAntigo(): Promise<{
  sessoes: number;
  auditoria: number;
}> {
  const service = createServiceClient();
  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: oldSessions, error: sessErr } = await service
    .from("app_assistente_sessoes")
    .select("id")
    .lt("updated_at", cutoff);

  if (sessErr) throw new Error(sessErr.message);

  let sessoes = 0;
  if (oldSessions?.length) {
    const ids = oldSessions.map((s) => s.id);
    const { error: delSessErr } = await service
      .from("app_assistente_sessoes")
      .delete()
      .in("id", ids);
    if (delSessErr) throw new Error(delSessErr.message);
    sessoes = ids.length;
  }

  const { data: oldAudit, error: auditErr } = await service
    .from("app_assistente_auditoria")
    .select("id")
    .lt("created_at", cutoff);

  if (auditErr) throw new Error(auditErr.message);

  let auditoria = 0;
  if (oldAudit?.length) {
    const ids = oldAudit.map((a) => a.id);
    const { error: delAuditErr } = await service
      .from("app_assistente_auditoria")
      .delete()
      .in("id", ids);
    if (delAuditErr) throw new Error(delAuditErr.message);
    auditoria = ids.length;
  }

  return { sessoes, auditoria };
}
