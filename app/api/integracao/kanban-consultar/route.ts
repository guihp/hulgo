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

  const telefone =
    (body.telefone_cliente as string) ??
    (body.telefone as string) ??
    (body.phone as string);

  if (!telefone?.trim()) {
    return json({ error: "telefone_cliente é obrigatório" }, 400);
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("consultar_cliente_kanban", {
    p_telefone: telefone.trim(),
  });

  if (error) {
    return json({ error: error.message }, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row?.encontrado) {
    return json({
      encontrado: false,
      telefone: row?.telefone ?? telefone.trim(),
      coluna: null,
      status: null,
      message:
        "Cliente ainda não está no funil. Será criado automaticamente ao cadastrar em dados_cliente_testehulgo.",
    });
  }

  return json({
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
}
