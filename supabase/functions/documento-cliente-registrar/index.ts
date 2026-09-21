import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const PROJECT_REF = "hzfvciamevimjzuvidcp";

function extractToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  const apikey = req.headers.get("apikey");
  if (apikey?.trim()) return apikey.trim();
  return null;
}

function isServiceRoleJwt(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "service_role" && payload.ref === PROJECT_REF;
  } catch {
    return false;
  }
}

function verifyServiceRole(req: Request): string | null {
  const token = extractToken(req);
  if (!token) return null;

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (serviceRoleKey && token === serviceRoleKey) return token;
  if (isServiceRoleJwt(token)) return token;

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const serviceRoleKey = verifyServiceRole(req);
  if (!serviceRoleKey) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const nomeDocumento =
    (body.nome_documento as string) ?? (body.nome as string) ?? (body.tipo as string);
  const urlMedia =
    (body.url_media as string) ??
    (body.conteudo_media as string) ??
    (body.url as string);

  if (!nomeDocumento?.trim()) {
    return jsonResponse({ error: "nome_documento is required" }, 400);
  }
  if (!urlMedia?.trim()) {
    return jsonResponse({ error: "url_media is required" }, 400);
  }

  const telefone =
    (body.telefone as string) ??
    (body.telefone_cliente as string) ??
    (body.phone as string);
  const cpf = body.cpf as string | undefined;
  const casoIdRaw = body.caso_id;
  const casoId =
    typeof casoIdRaw === "number"
      ? casoIdRaw
      : typeof casoIdRaw === "string" && casoIdRaw.trim()
        ? Number(casoIdRaw)
        : null;

  if (!telefone?.trim() && !cpf?.trim() && !casoId) {
    return jsonResponse(
      { error: "Informe telefone, cpf ou caso_id para vincular o documento" },
      400
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("registrar_documento_cliente", {
    p_nome_documento: nomeDocumento.trim(),
    p_url_media: urlMedia.trim(),
    p_descricao: (body.descricao as string) ?? (body.description as string) ?? null,
    p_telefone: telefone?.trim() || null,
    p_cpf: cpf?.trim() || null,
    p_caso_id: casoId && !Number.isNaN(casoId) ? casoId : null,
    p_mensagem_id: (body.mensagem_id as string) ?? null,
    p_mensagem_row_id:
      typeof body.mensagem_row_id === "number"
        ? body.mensagem_row_id
        : typeof body.id === "number"
          ? body.id
          : null,
    p_origem: (body.origem as string) ?? "whatsapp",
    p_nome_cliente:
      (body.nome_cliente as string) ?? (body.nome as string) ?? null,
  });

  if (error) {
    const status = error.message.includes("não encontrado") ? 404 : 500;
    return jsonResponse({ error: error.message }, status);
  }

  const row = Array.isArray(data) ? data[0] : data;

  return jsonResponse({
    documento_id: row?.documento_id ?? row?.id,
    caso_id: row?.caso_id,
    documentos_recebidos: row?.documentos_recebidos,
    documentos_faltantes: row?.documentos_faltantes,
    message: "Documento registrado com sucesso",
  });
});
