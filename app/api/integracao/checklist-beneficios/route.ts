import { NextResponse } from "next/server";
import { verifyIntegracaoToken } from "@/lib/config/app-config";
import {
  listTiposCaso,
  matchTipoCaso,
} from "@/lib/data/tipos-caso";

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

function publicTipo(t: {
  chave: string;
  label: string;
  aliases: string[];
  documentos: string[];
}) {
  return {
    chave: t.chave,
    label: t.label,
    aliases: t.aliases,
    documentos: t.documentos,
  };
}

/**
 * GET /api/integracao/checklist-beneficios
 * Auth: x-integracao-token ou Authorization: Bearer
 *
 * Sem query → todos os tipos ativos
 * ?beneficio=texto → melhor match + documentos
 */
export async function GET(req: Request) {
  const token = extractToken(req);
  if (!(await verifyIntegracaoToken(token))) {
    return json({ error: "Token de integração inválido" }, 401);
  }

  const url = new URL(req.url);
  const beneficio = url.searchParams.get("beneficio");

  try {
    const tipos = await listTiposCaso({ service: true });

    if (beneficio != null && beneficio.trim() !== "") {
      const match = matchTipoCaso(tipos, beneficio);
      return json({
        match: publicTipo(match),
        beneficio: beneficio.trim(),
      });
    }

    return json({
      tipos: tipos.map(publicTipo),
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Erro ao listar tipos" },
      500
    );
  }
}
