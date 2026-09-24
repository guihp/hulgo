import { NextResponse } from "next/server";
import { verifyIntegracaoToken } from "@/lib/config/app-config";
import { enviarEncaminhamentoAnaliseSePendente } from "@/lib/casos/encaminhamento-analise";
import { listKanbanColunas } from "@/lib/data/kanban-colunas";
import { createServiceClient } from "@/lib/supabase/service";
import { CASO_STATUS } from "@/lib/constants";

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

async function allowedStatusKeys(): Promise<string[]> {
  try {
    const cols = await listKanbanColunas({
      includeInactive: false,
      service: true,
      allowFallback: true,
    });
    if (cols.length) return cols.map((c) => c.chave);
  } catch {
    // fallback abaixo
  }
  return CASO_STATUS.map((s) => s.value);
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
  const status = (body.coluna as string) ?? (body.status as string);

  if (!telefone?.trim()) {
    return json({ error: "telefone_cliente é obrigatório" }, 400);
  }
  if (!status?.trim()) {
    return json({ error: "coluna (status) é obrigatório" }, 400);
  }

  const allowed = await allowedStatusKeys();
  const statusKey = status.trim();
  if (!allowed.includes(statusKey)) {
    return json(
      {
        error: `coluna inválida. Valores permitidos: ${allowed.join(", ")}`,
      },
      400
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("mover_cliente_kanban", {
    p_telefone: telefone.trim(),
    p_status: statusKey,
    p_motivo: (body.motivo as string) ?? null,
    p_nome_cliente:
      (body.nome_cliente as string) ?? (body.nome as string) ?? null,
  });

  if (error) {
    const statusCode = error.message.includes("inválid") ? 400 : 500;
    return json({ error: error.message }, statusCode);
  }

  const row = Array.isArray(data) ? data[0] : data;

  let encaminhamento: { enviada: boolean; warning?: string } | undefined;
  if (statusKey === "aguardando_analise" && row?.caso_id != null) {
    encaminhamento = await enviarEncaminhamentoAnaliseSePendente([
      Number(row.caso_id),
    ]);
  }

  return json({
    caso_id: row?.caso_id,
    status: row?.status,
    telefone: row?.telefone,
    message: "Cliente movido no funil com sucesso",
    ...(encaminhamento
      ? {
          mensagem_encaminhamento_enviada: encaminhamento.enviada,
          ...(encaminhamento.warning
            ? { mensagem_encaminhamento_warning: encaminhamento.warning }
            : {}),
        }
      : {}),
  });
}
