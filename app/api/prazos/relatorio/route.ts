import { NextResponse, type NextRequest } from "next/server";
import { getAppUser } from "@/lib/actions/auth";
import { getAppConfigValue } from "@/lib/config/app-config";
import {
  carregarRelatorioPrazos,
  RelatorioPrazosParamError,
} from "@/lib/relatorios/prazos-dados";
import {
  gerarPdfRelatorioPrazos,
  nomeArquivoRelatorioPrazos,
} from "@/lib/relatorios/prazos-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/prazos/relatorio?modo=pagamentos&situacao=atrasados[&q=&tipo=&processo=&parceiro=&download=1]
 * Mesmos filtros da tela (lib/prazos/filtro.ts). Abre inline; download=1 força baixar.
 */
export async function GET(request: NextRequest) {
  const user = await getAppUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  try {
    const dados = await carregarRelatorioPrazos({
      modo: sp.get("modo"),
      situacao: sp.get("situacao"),
      busca: sp.get("q"),
      tipo: sp.get("tipo"),
      processo: sp.get("processo"),
      parceiro: sp.get("parceiro"),
    });
    const escritorio =
      (await getAppConfigValue("escritorio_nome").catch(() => "")).trim() ||
      "Boueres e Fonteles Advogados";
    const bytes = await gerarPdfRelatorioPrazos(dados, {
      escritorio,
      geradoPor: user.nome,
    });
    const disposicao = sp.get("download") === "1" ? "attachment" : "inline";

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposicao}; filename="${nomeArquivoRelatorioPrazos(dados)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof RelatorioPrazosParamError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[relatorio-prazos]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Falha ao gerar relatório" },
      { status: 500 }
    );
  }
}
