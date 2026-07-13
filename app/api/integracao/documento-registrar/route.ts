import { NextResponse } from "next/server";
import { verifyIntegracaoToken } from "@/lib/config/app-config";
import { createServiceClient } from "@/lib/supabase/service";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function extractToken(req: Request): string | null {
  const header = req.headers.get("x-integracao-token");
  if (header?.trim()) return header.trim();

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();

  return null;
}

export async function POST(req: Request) {
  const token = extractToken(req);
  if (!(await verifyIntegracaoToken(token))) {
    return json({ error: "Token de integração inválido" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const nomeDocumento =
    (body.nome_documento as string) ?? (body.nome as string) ?? (body.tipo as string);
  const urlMedia =
    (body.url_media as string) ??
    (body.conteudo_media as string) ??
    (body.url as string);

  if (!nomeDocumento?.trim()) {
    return json({ error: "nome_documento é obrigatório" }, 400);
  }
  if (!urlMedia?.trim()) {
    return json({ error: "url_media é obrigatório" }, 400);
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
    return json(
      { error: "Informe telefone, cpf ou caso_id para vincular o documento" },
      400
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("registrar_documento_cliente", {
    p_nome_documento: nomeDocumento.trim(),
    p_url_media: urlMedia.trim(),
    p_descricao: (body.descricao as string) ?? (body.description as string) ?? null,
    p_telefone: telefone?.trim() || null,
    p_cpf: cpf?.trim() || null,
    p_caso_id: casoId && !Number.isNaN(casoId) ? casoId : null,
    p_mensagem_id: (body.mensagem_id as string) ?? null,
    p_mensagem_row_id:
      typeof body.mensagem_row_id === "number" ? body.mensagem_row_id : null,
    p_origem: (body.origem as string) ?? "whatsapp",
    p_nome_cliente:
      (body.nome_cliente as string) ?? (body.nome as string) ?? null,
  });

  if (error) {
    const status = error.message.includes("não encontrado") ? 404 : 500;
    return json({ error: error.message }, status);
  }

  const row = Array.isArray(data) ? data[0] : data;

  return json({
    documento_id: row?.documento_id,
    caso_id: row?.caso_id,
    documentos_recebidos: row?.documentos_recebidos,
    documentos_faltantes: row?.documentos_faltantes,
    message: "Documento registrado com sucesso",
  });
}
