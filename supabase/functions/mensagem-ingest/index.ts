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

  const phone = body.phone as string | undefined;
  const type = body.type as string | undefined;

  if (!phone || !type) {
    return jsonResponse({ error: "phone and type are required" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("upsert_mensagem", {
    p_phone: phone,
    p_type: type,
    p_text: (body.text as string) ?? null,
    p_mensagem_id: (body.mensagem_id as string) ?? null,
    p_mensage_type: (body.mensage_type as string) ?? null,
    p_plataforma: (body.plataforma as string) ?? "whatsapp",
    p_instancia: (body.instancia as string) ?? null,
    p_session_id: (body.session_id as string) ?? null,
    p_conteudo_media: (body.conteudo_media as string) ?? null,
  });

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const id = row?.result_id ?? row?.id;
  const contact_norm = row?.result_contact_norm ?? row?.contact_norm;

  return jsonResponse({ id, contact_norm });
});
