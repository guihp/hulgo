import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { DocumentoTemplate, LinhaPlacement } from "@/lib/utils/documentos";

const TAMANHO_PADRAO = 10;
const TAMANHO_MINIMO = 5;

/** Helvetica só aceita WinAnsi; troca o que estiver fora por equivalente. */
function sanitizar(texto: string): string {
  return texto
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reduz o corpo até o texto caber na largura disponível. */
function ajustarTamanho(
  font: PDFFont,
  texto: string,
  tamanho: number,
  maxWidth?: number
): number {
  if (!maxWidth) return tamanho;
  let atual = tamanho;
  while (atual > TAMANHO_MINIMO && font.widthOfTextAtSize(texto, atual) > maxWidth) {
    atual -= 0.25;
  }
  return atual;
}

/** Distribui o texto pelas linhas em branco do formulário. */
function quebrarEmLinhas(
  font: PDFFont,
  texto: string,
  tamanho: number,
  linhas: LinhaPlacement[]
): { linha: LinhaPlacement; texto: string }[] {
  const palavras = texto.split(" ").filter(Boolean);
  const resultado: { linha: LinhaPlacement; texto: string }[] = [];
  let indice = 0;

  for (const linha of linhas) {
    if (indice >= palavras.length) break;
    let atual = "";
    while (indice < palavras.length) {
      const proximo = atual ? `${atual} ${palavras[indice]}` : palavras[indice];
      if (font.widthOfTextAtSize(proximo, tamanho) > linha.maxWidth && atual) break;
      atual = proximo;
      indice += 1;
    }
    resultado.push({ linha, texto: atual });
  }

  // Sobrou texto: encaixa o resto na última linha (será reduzido de corpo).
  if (indice < palavras.length && resultado.length) {
    const ultima = resultado[resultado.length - 1];
    ultima.texto = `${ultima.texto} ${palavras.slice(indice).join(" ")}`.trim();
  }
  return resultado;
}

/**
 * `modeloBytes`: no servidor, passe o PDF do modelo lido do disco
 * (`fetch` relativo só funciona no navegador).
 */
export async function preencherPdf(
  template: DocumentoTemplate,
  valores: Record<string, string>,
  modeloBytes?: Uint8Array | ArrayBuffer
): Promise<Uint8Array> {
  let bytes = modeloBytes;
  if (!bytes) {
    const resposta = await fetch(template.file);
    if (!resposta.ok) {
      throw new Error(`Não foi possível carregar o modelo ${template.file}`);
    }
    bytes = await resposta.arrayBuffer();
  }
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const paginas = pdf.getPages();
  const cor = rgb(0, 0, 0);

  for (const placement of template.placements) {
    const bruto = placement.when
      ? valores[placement.key] === placement.when
        ? placement.text ?? "X"
        : ""
      : placement.text ?? valores[placement.key] ?? "";
    const texto = sanitizar(bruto);
    if (!texto) continue;

    const pagina = paginas[placement.page - 1];
    if (!pagina) continue;
    const tamanhoBase = placement.size ?? TAMANHO_PADRAO;

    if (placement.lines?.length) {
      for (const { linha, texto: parte } of quebrarEmLinhas(
        font,
        texto,
        tamanhoBase,
        placement.lines
      )) {
        if (!parte) continue;
        pagina.drawText(parte, {
          x: linha.x,
          y: linha.y,
          size: ajustarTamanho(font, parte, tamanhoBase, linha.maxWidth),
          font,
          color: cor,
        });
      }
      continue;
    }

    pagina.drawText(texto, {
      x: placement.x,
      y: placement.y,
      size: ajustarTamanho(font, texto, tamanhoBase, placement.maxWidth),
      font,
      color: cor,
    });
  }

  return pdf.save();
}

export function nomeArquivo(template: DocumentoTemplate, nome: string): string {
  const cliente = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return cliente ? `${template.slug}-${cliente}.pdf` : `${template.slug}.pdf`;
}
