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

function asText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === "null" || t.toLowerCase() === "undefined") return null;
  return t;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["true", "sim", "yes", "1"].includes(t)) return true;
    if (["false", "não", "nao", "no", "0"].includes(t)) return false;
  }
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
    asText(body.telefone_cliente) ?? asText(body.telefone) ?? asText(body.phone);
  if (!telefone) {
    return jsonResponse({ error: "telefone_cliente é obrigatório" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("atualizar_dados_caso", {
    p_telefone: telefone,
    p_nome: asText(body.nome),
    p_cpf: asText(body.cpf),
    p_data_nascimento: asText(body.data_nascimento),
    p_beneficio_identificado: asText(body.beneficio_identificado),
    p_area: asText(body.area),
    p_tipo_segurado: asText(body.tipo_segurado),
    p_ja_negou_inss: asBool(body.ja_negou_inss),
    p_motivo_negativa: asText(body.motivo_negativa),
    p_ja_tem_processo: asBool(body.ja_tem_processo),
    p_ja_recebe_beneficio: asText(body.ja_recebe_beneficio),
    p_requisitos_preenchidos: asText(body.requisitos_preenchidos),
    p_requisitos_pendentes: asText(body.requisitos_pendentes),
    p_pontos_analise_juridica: asText(body.pontos_analise_juridica),
    p_beneficios_alternativos: asText(body.beneficios_alternativos),
  });

  if (error) {
    const statusCode = error.message.includes("inválid") ? 400 : 500;
    return jsonResponse({ error: error.message }, statusCode);
  }

  const row = Array.isArray(data) ? data[0] : data;

  return jsonResponse({
    caso_id: row?.caso_id,
    status: row?.status,
    campos_atualizados: row?.campos_atualizados,
    message: "Dados do caso atualizados com sucesso",
  });
});
