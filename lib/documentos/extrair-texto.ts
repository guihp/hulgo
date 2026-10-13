/**
 * Extração local de texto de documentos (PDF, DOCX, XLSX, PPTX, ODT/ODS/ODP).
 * Tabelas viram linhas com colunas separadas por " | " para o modelo
 * conseguir ler planilhas/listas linha a linha.
 *
 * Retorna null quando o formato não é suportado ou o arquivo não tem texto
 * (ex.: PDF digitalizado) — o chamador decide o fallback.
 */

import { unzipSync, strFromU8 } from "fflate";

const MAX_CHARS = 80_000;

export type FormatoDocumento = "pdf" | "docx" | "xlsx" | "pptx" | "odf";

export function detectarFormatoDocumento(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string
): FormatoDocumento | null {
  const name = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();
  const head = String.fromCharCode(...bytes.subarray(0, 5));
  if (head === "%PDF-" || mime === "application/pdf" || name.endsWith(".pdf")) {
    return "pdf";
  }
  // Formatos Office/ODF modernos são zip ("PK").
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  if (name.endsWith(".docx") || mime.includes("wordprocessingml")) return "docx";
  if (name.endsWith(".xlsx") || mime.includes("spreadsheetml")) return "xlsx";
  if (name.endsWith(".pptx") || mime.includes("presentationml")) return "pptx";
  if (/\.od[tsp]$/.test(name) || mime.includes("opendocument")) return "odf";
  return null;
}

export async function extrairTextoDocumento(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}): Promise<string | null> {
  const formato = detectarFormatoDocumento(
    input.bytes,
    input.fileName,
    input.mimeType
  );
  if (!formato) return null;

  let texto: string;
  switch (formato) {
    case "pdf":
      texto = await textoPdf(input.bytes);
      break;
    case "docx":
      texto = textoDocx(unzip(input.bytes));
      break;
    case "xlsx":
      texto = textoXlsx(unzip(input.bytes));
      break;
    case "pptx":
      texto = textoPptx(unzip(input.bytes));
      break;
    case "odf":
      texto = textoOdf(unzip(input.bytes));
      break;
  }

  texto = texto
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (texto.replace(/[\s|]/g, "").length < 10) return null;
  if (texto.length > MAX_CHARS) {
    texto = `${texto.slice(0, MAX_CHARS)}\n[… documento truncado em ${MAX_CHARS} caracteres]`;
  }
  return texto;
}

// ---------------------------------------------------------------- helpers

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes, {
    // Só os XMLs — ignora imagens/mídia embutida.
    filter: (f) => f.name.endsWith(".xml"),
  });
}

function xmlFile(files: Record<string, Uint8Array>, path: string): string {
  const f = files[path];
  return f ? strFromU8(f) : "";
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

const TOKEN = /<(\/?)([\w:.-]+)[^>]*?(\/?)>|([^<]+)/g;

/**
 * Percorre o XML emitindo só o texto dos elementos `textTag` e convertendo
 * marcações de estrutura (parágrafo, célula, linha, tab, quebra) em texto.
 */
function walkXml(
  xml: string,
  opts: {
    textTags: string[];
    paragraph: string[];
    cell: string;
    row: string;
    tab?: string[];
    br?: string[];
  }
): string {
  const out: string[] = [];
  let inText = 0;
  let cellDepth = 0;
  for (const m of xml.matchAll(TOKEN)) {
    const [, closing, tag, selfClosing, text] = m;
    if (text !== undefined) {
      if (inText > 0) out.push(decodeXml(text));
      continue;
    }
    if (opts.textTags.includes(tag)) {
      if (selfClosing) continue;
      inText += closing ? -1 : 1;
    } else if (tag === opts.cell) {
      if (selfClosing) out.push(" | ");
      else if (closing) {
        cellDepth--;
        out.push(" | ");
      } else cellDepth++;
    } else if (tag === opts.row && closing) {
      out.push("\n");
    } else if (opts.paragraph.includes(tag) && (closing || selfClosing)) {
      out.push(cellDepth > 0 ? " " : "\n");
    } else if (opts.tab?.includes(tag)) {
      out.push("\t");
    } else if (opts.br?.includes(tag)) {
      out.push(cellDepth > 0 ? " " : "\n");
    }
  }
  return out
    .join("")
    .replace(/ *\| *\n/g, "\n")
    .replace(/[ \t]*\|[ \t]*/g, " | ")
    .replace(/ {2,}/g, " ");
}

// ---------------------------------------------------------------- PDF

type PdfTextItem = { str: string; transform: number[]; width: number };

async function textoPdf(bytes: Uint8Array): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  // verbosity 0: sem avisos de fonte padrão (só lemos texto, não renderizamos).
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  const paginas: string[] = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = (content.items as PdfTextItem[]).filter(
        (i) => typeof i.str === "string" && i.str.trim() !== ""
      );
      paginas.push(linhasPdf(items));
    }
  } finally {
    await pdf.cleanup();
  }
  return paginas
    .map((t, i) => (paginas.length > 1 ? `--- Página ${i + 1} ---\n${t}` : t))
    .join("\n\n");
}

/** Agrupa itens pela altura (y) e separa colunas por espaços largos. */
function linhasPdf(items: PdfTextItem[]): string {
  const linhas: { y: number; itens: PdfTextItem[] }[] = [];
  for (const it of items) {
    const y = it.transform[5];
    const linha = linhas.find((l) => Math.abs(l.y - y) < 3);
    if (linha) linha.itens.push(it);
    else linhas.push({ y, itens: [it] });
  }
  linhas.sort((a, b) => b.y - a.y);
  return linhas
    .map(({ itens }) => {
      itens.sort((a, b) => a.transform[4] - b.transform[4]);
      let s = "";
      let fimAnterior: number | null = null;
      for (const it of itens) {
        const x = it.transform[4];
        if (fimAnterior !== null) {
          const gap = x - fimAnterior;
          if (gap > 8) s += " | ";
          else if (gap > 1 && !s.endsWith(" ") && !it.str.startsWith(" ")) s += " ";
        }
        s += it.str;
        fimAnterior = x + it.width;
      }
      return s.trim();
    })
    .join("\n");
}

// ---------------------------------------------------------------- DOCX

function textoDocx(files: Record<string, Uint8Array>): string {
  const opts = {
    textTags: ["w:t"],
    paragraph: ["w:p"],
    cell: "w:tc",
    row: "w:tr",
    tab: ["w:tab"],
    br: ["w:br", "w:cr"],
  };
  const partes = [walkXml(xmlFile(files, "word/document.xml"), opts)];
  for (const extra of ["word/footnotes.xml", "word/endnotes.xml"]) {
    const t = walkXml(xmlFile(files, extra), opts).trim();
    if (t) partes.push(t);
  }
  return partes.join("\n\n");
}

// ---------------------------------------------------------------- XLSX

/** IDs de formato numérico embutidos do Excel que são datas. */
const XLSX_DATE_FMT_IDS = new Set([14, 15, 16, 17, 22, 45, 46, 47]);

function textoXlsx(files: Record<string, Uint8Array>): string {
  const shared = [
    ...xmlFile(files, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map((m) =>
    decodeXml(
      [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")
    )
  );

  // Estilos de célula que são datas.
  const styles = xmlFile(files, "xl/styles.xml");
  const customDate = new Set<number>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    const code = decodeXml(m[2]).replace(/"[^"]*"|\[[^\]]*\]/g, "");
    if (/[dy]/i.test(code)) customDate.add(Number(m[1]));
  }
  const cellXfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  const dateStyles = [...cellXfs.matchAll(/<xf\b[^>]*?numFmtId="(\d+)"/g)].map(
    (m) => XLSX_DATE_FMT_IDS.has(Number(m[1])) || customDate.has(Number(m[1]))
  );

  const nomes = [
    ...xmlFile(files, "xl/workbook.xml").matchAll(/<sheet\b[^>]*name="([^"]*)"/g),
  ].map((m) => decodeXml(m[1]));

  const sheets = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

  return sheets
    .map((path, idx) => {
      const xml = xmlFile(files, path);
      const linhas: string[] = [];
      for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells: string[] = [];
        for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = c[1];
          const body = c[2] ?? "";
          const col = colIndex(attrs.match(/\br="([A-Z]+)\d+"/)?.[1]);
          const tipo = attrs.match(/\bt="(\w+)"/)?.[1];
          const estilo = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? -1);
          const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          let valor = "";
          if (tipo === "s" && v !== undefined) valor = shared[Number(v)] ?? "";
          else if (tipo === "inlineStr") {
            valor = decodeXml(
              [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")
            );
          } else if (v !== undefined) {
            valor = decodeXml(v);
            if (!tipo && dateStyles[estilo]) valor = serialParaData(Number(valor));
          }
          if (col !== null) {
            while (cells.length < col) cells.push("");
            cells[col] = valor.trim();
          } else cells.push(valor.trim());
        }
        if (cells.some((c) => c !== "")) linhas.push(cells.join(" | "));
      }
      const nome = nomes[idx] ?? `Planilha ${idx + 1}`;
      return linhas.length ? `--- Aba: ${nome} ---\n${linhas.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function colIndex(letters: string | undefined): number | null {
  if (!letters) return null;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Serial de data do Excel (sistema 1900) → dd/mm/aaaa [hh:mm]. */
function serialParaData(serial: number): string {
  if (!Number.isFinite(serial)) return String(serial);
  const ms = Math.round((serial - 25569) * 86_400_000);
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const data = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  const temHora = d.getUTCHours() || d.getUTCMinutes();
  return temHora ? `${data} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : data;
}

// ---------------------------------------------------------------- PPTX / ODF

function textoPptx(files: Record<string, Uint8Array>): string {
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return slides
    .map((path, i) => {
      const t = walkXml(xmlFile(files, path), {
        textTags: ["a:t"],
        paragraph: ["a:p"],
        cell: "a:tc",
        row: "a:tr",
        br: ["a:br"],
      }).trim();
      return t ? `--- Slide ${i + 1} ---\n${t}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function textoOdf(files: Record<string, Uint8Array>): string {
  // ODF guarda o texto direto no corpo dos elementos; trata o content.xml
  // inteiro como "texto" e usa as tags de estrutura como separadores.
  const xml = xmlFile(files, "content.xml");
  const body = xml.match(/<office:body>([\s\S]*)<\/office:body>/)?.[1] ?? "";
  return walkXml(`<x>${body}</x>`, {
    textTags: ["x"],
    paragraph: ["text:p", "text:h"],
    cell: "table:table-cell",
    row: "table:table-row",
    tab: ["text:tab"],
    br: ["text:line-break"],
  }).replace(/^\n+/, "");
}
