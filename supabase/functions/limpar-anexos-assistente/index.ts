import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Apaga anexos do assistente interno com mais de 1 dia que não foram salvos
 * em ficha (lista vem de public.anexos_assistente_expirados).
 * Chamada pelo pg_cron (job limpar-anexos-assistente) com o header x-cleanup-key,
 * validado no banco contra o Vault. verify_jwt = false.
 */

const BUCKET = "mensagens-media";
const LOTE = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const chave = req.headers.get("x-cleanup-key")?.trim();
  if (!chave) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const { data, error } = await supabase.rpc("anexos_assistente_expirados", {
    p_chave: chave,
    p_limite: 1000,
  });
  if (error) {
    const negado = error.code === "42501";
    return json({ error: negado ? "Unauthorized" : error.message }, negado ? 401 : 500);
  }

  const nomes = ((data ?? []) as { name: string }[]).map((r) => r.name);
  let removidos = 0;
  const erros: string[] = [];

  for (let i = 0; i < nomes.length; i += LOTE) {
    const lote = nomes.slice(i, i + LOTE);
    const { data: rem, error: remErr } = await supabase.storage.from(BUCKET).remove(lote);
    if (remErr) erros.push(remErr.message);
    else removidos += rem?.length ?? 0;
  }

  // Sessões com anexo pendente apontando para arquivo apagado: limpa a referência
  // para a IA não oferecer salvar um arquivo que não existe mais.
  if (removidos) {
    const prefixo = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${BUCKET}/`;
    const urls = nomes.map((n) => prefixo + n);
    for (let i = 0; i < urls.length; i += LOTE) {
      await supabase
        .from("app_assistente_sessoes")
        .update({ pending_anexo: null })
        .in("pending_anexo->>url_media", urls.slice(i, i + LOTE));
    }
  }

  return json({ ok: erros.length === 0, encontrados: nomes.length, removidos, erros });
});
