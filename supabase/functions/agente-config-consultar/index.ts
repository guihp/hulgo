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
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
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

function rascunhoEfetivo(row: {
  persona: string | null;
  mensagem_abertura: string | null;
  persona_rascunho: string | null;
  mensagem_abertura_rascunho: string | null;
}): { persona: string; mensagem_abertura: string } {
  const personaRascunho = (row.persona_rascunho ?? "").trim();
  const aberturaRascunho = (row.mensagem_abertura_rascunho ?? "").trim();
  return {
    persona: personaRascunho || row.persona || "",
    mensagem_abertura: aberturaRascunho || row.mensagem_abertura || "",
  };
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

  // Body opcional — n8n envia `={}` / `{}`
  try {
    const text = await req.text();
    if (text.trim()) JSON.parse(text);
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("app_agente_config")
    .select(
      "persona, mensagem_abertura, persona_rascunho, mensagem_abertura_rascunho, versao, published_at, updated_at",
    )
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }
  if (!data) {
    return jsonResponse({ error: "Configuração do agente não encontrada" }, 404);
  }

  const rascunho = rascunhoEfetivo(data);

  return jsonResponse({
    versao: data.versao ?? 0,
    published_at: data.published_at ?? null,
    updated_at: data.updated_at ?? null,
    rascunho: {
      persona: rascunho.persona,
      mensagem_abertura: rascunho.mensagem_abertura,
    },
    producao: {
      persona: data.persona ?? "",
      mensagem_abertura: data.mensagem_abertura ?? "",
    },
  });
});
