import { createServiceClient } from "@/lib/supabase/service";

const RETENTION_DAYS = 7;

/**
 * Removes sandbox sessions older than 7 days (DB rows + storage paths).
 */
export async function limparSandboxAntigo(): Promise<{
  sessoes: number;
  arquivos: number;
}> {
  const service = createServiceClient();
  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: oldSessions, error } = await service
    .from("app_agente_sandbox_sessoes")
    .select("id")
    .lt("created_at", cutoff);

  if (error) throw new Error(error.message);
  if (!oldSessions?.length) return { sessoes: 0, arquivos: 0 };

  const ids = oldSessions.map((s) => s.id);

  const { data: mediaRows } = await service
    .from("app_agente_sandbox_mensagens")
    .select("media_path")
    .in("sessao_id", ids)
    .not("media_path", "is", null);

  const paths = (mediaRows ?? [])
    .map((r) => r.media_path)
    .filter((p): p is string => Boolean(p));

  let arquivos = 0;
  if (paths.length) {
    const { error: remErr } = await service.storage
      .from("mensagens-media")
      .remove(paths);
    if (!remErr) arquivos = paths.length;
  }

  const { error: delErr } = await service
    .from("app_agente_sandbox_sessoes")
    .delete()
    .in("id", ids);
  if (delErr) throw new Error(delErr.message);

  return { sessoes: ids.length, arquivos };
}
