import { NextResponse, type NextRequest } from "next/server";
import { getAppUser } from "@/lib/actions/auth";
import {
  carregarDocumentoGerado,
  renderizarDocumento,
} from "@/lib/documentos/gerados";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function paginaExpirado() {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link expirado</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{max-width:420px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px;text-align:center}
h1{font-size:20px;color:#0b2148;margin:0 0 8px}p{color:#64748b;line-height:1.5;margin:0}</style></head>
<body><main><h1>Este link expirou</h1><p>Documentos preenchidos ficam disponíveis por 1 dia e depois são apagados.
Peça ao assistente para gerar de novo.</p></main></body></html>`;
  return new NextResponse(html, {
    status: 410,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * GET /api/documentos/gerados/{id}[?download=1]
 * Monta o PDF na hora a partir dos valores salvos (nada fica no Storage).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAppUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await carregarDocumentoGerado(id);
  if (!doc) return paginaExpirado();

  try {
    const { bytes, nome } = await renderizarDocumento(doc.template, doc.valores);
    const disposicao =
      request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposicao}; filename="${nome}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[documentos-gerados]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Falha ao gerar documento" },
      { status: 500 }
    );
  }
}
