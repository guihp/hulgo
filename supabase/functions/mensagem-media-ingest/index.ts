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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResponse({ error: "Expected multipart/form-data" }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonResponse({ error: "file is required" }, 400);
  }

  const mensagemRowId = form.get("mensagem_row_id")?.toString();
  const mensagemId = form.get("mensagem_id")?.toString();
  const phone = form.get("phone")?.toString();
  const type = form.get("type")?.toString() ?? "lead";
  const text = form.get("text")?.toString() ?? null;
  const mensageType = form.get("mensage_type")?.toString() ?? file.type.split("/")[0];
  const plataforma = form.get("plataforma")?.toString() ?? "whatsapp";
  const instancia = form.get("instancia")?.toString() ?? null;
  const sessionId = form.get("session_id")?.toString() ?? null;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let rowId: number | null = mensagemRowId ? Number(mensagemRowId) : null;
  let contactNorm: string | null = null;
  let resolvedMensagemId = mensagemId ?? null;

  if (!rowId && phone) {
    const { data: upsertData, error: upsertError } = await supabase.rpc(
      "upsert_mensagem",
      {
        p_phone: phone,
        p_type: type,
        p_text: text,
        p_mensagem_id: mensagemId ?? null,
        p_mensage_type: mensageType,
        p_plataforma: plataforma,
        p_instancia: instancia,
        p_session_id: sessionId,
      }
    );

    if (upsertError) {
      return jsonResponse({ error: upsertError.message }, 500);
    }

    const row = Array.isArray(upsertData) ? upsertData[0] : upsertData;
    rowId = row?.result_id ?? null;
    contactNorm = row?.result_contact_norm ?? null;
    resolvedMensagemId = mensagemId ?? String(rowId);
  }

  if (!rowId) {
    if (mensagemId) {
      const { data: byMsgId } = await supabase
        .from("mensagens")
        .select("id, contact_norm, mensagem_id")
        .eq("mensagem_id", mensagemId)
        .maybeSingle();
      if (byMsgId) {
        rowId = byMsgId.id;
        contactNorm = byMsgId.contact_norm;
        resolvedMensagemId = byMsgId.mensagem_id;
      }
    } else if (mensagemRowId) {
      const { data: byId } = await supabase
        .from("mensagens")
        .select("id, contact_norm, mensagem_id")
        .eq("id", Number(mensagemRowId))
        .maybeSingle();
      if (byId) {
        rowId = byId.id;
        contactNorm = byId.contact_norm;
        resolvedMensagemId = byId.mensagem_id;
      }
    }
  }

  if (!rowId || !contactNorm) {
    return jsonResponse(
      { error: "Message row not found. Call mensagem-ingest first or provide valid mensagem_row_id." },
      404
    );
  }

  const ext = file.name.split(".").pop() ?? "bin";
  const storagePath = `${contactNorm}/${resolvedMensagemId ?? rowId}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from("mensagens-media")
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });

  if (uploadError) {
    return jsonResponse({ error: uploadError.message }, 500);
  }

  const { data: publicUrlData } = supabase.storage
    .from("mensagens-media")
    .getPublicUrl(storagePath);

  const publicUrl = publicUrlData.publicUrl;

  const { error: updateError } = await supabase
    .from("mensagens")
    .update({
      conteudo_media: publicUrl,
      mensage_type: mensageType,
    })
    .eq("id", rowId);

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 500);
  }

  return jsonResponse({
    id: rowId,
    contact_norm: contactNorm,
    conteudo_media: publicUrl,
  });
});
