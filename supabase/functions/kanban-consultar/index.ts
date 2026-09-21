import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PROJECT_REF = "hzfvciamevimjzuvidcp";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

  const telefone =
    (body.telefone_cliente as string) ??
    (body.telefone as string) ??
    (body.phone as string);

  if (!telefone?.trim()) {
    return jsonResponse({ error: "telefone_cliente é obrigatório" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("consultar_cliente_kanban", {
    p_telefone: telefone.trim(),
  });

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row?.encontrado) {
    return jsonResponse({
      encontrado: false,
      telefone: row?.telefone ?? telefone.trim(),
      coluna: null,
      status: null,
      message:
        "Cliente ainda não está no funil. Será criado ao cadastrar em dados_cliente_testehulgo.",
    });
  }

  return jsonResponse({
    encontrado: true,
    caso_id: row.caso_id,
    status: row.status,
    coluna: row.coluna,
    nome: row.nome,
    cpf: row.cpf,
    beneficio_identificado: row.beneficio_identificado,
    documentos_recebidos: row.documentos_recebidos,
    documentos_faltantes: row.documentos_faltantes,
    telefone: row.telefone,
  });
});
