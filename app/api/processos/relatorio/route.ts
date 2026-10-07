import { NextResponse, type NextRequest } from "next/server";
import { getAppUser } from "@/lib/actions/auth";
import { getAppConfigValue } from "@/lib/config/app-config";
import {
  carregarRelatorioProcessos,
  RelatorioParamError,
} from "@/lib/relatorios/processos-dados";
import {
  gerarPdfRelatorioProcessos,
  nomeArquivoRelatorio,
} from "@/lib/relatorios/processos-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/processos/relatorio?funil=previdenciario&coluna=sentenca[&download=1]
 * funil omitido = todos os funis; coluna omitida = todas as colunas do funil.
 * Abre inline no navegador (download=1 força baixar).
 */
export async function GET(request: NextRequest) {
  const user = await getAppUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  try {
    const dados = await carregarRelatorioProcessos({
      funil: sp.get("funil"),
      coluna: sp.get("coluna"),
    });
    const escritorio =
      (await getAppConfigValue("escritorio_nome").catch(() => "")).trim() ||
      "Boueres e Fonteles Advogados";
    const bytes = await gerarPdfRelatorioProcessos(dados, {
      escritorio,
      geradoPor: user.nome,
    });
    const nome = nomeArquivoRelatorio(dados);
    const disposicao = sp.get("download") === "1" ? "attachment" : "inline";

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposicao}; filename="${nome}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof RelatorioParamError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[relatorio-processos]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Falha ao gerar relatório" },
      { status: 500 }
    );
  }
}
