import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import { formatCpfCnpj } from "@/lib/utils/cpf";
import { formatNumeroProcesso } from "@/lib/utils/processo";
import {
  formatValorCentavos,
  situacaoProcessoInfo,
} from "@/lib/utils/processos";
import type {
  RelatorioColuna,
  RelatorioProcessoItem,
  RelatorioProcessosDados,
} from "@/lib/relatorios/processos-dados";

// ---------------------------------------------------------------------------
// Layout (A4 paisagem, pontos)
// ---------------------------------------------------------------------------
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN_X = 32;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const HEADER_H = 64;
const FOOTER_H = 30;
const TOP = PAGE_H - HEADER_H - 14;
const BOTTOM = FOOTER_H + 14;

const FONT_SIZE = 8;
const LINE_H = 10.4;
const CELL_PAD_X = 5;
const CELL_PAD_Y = 5;
const MAX_LINHAS_CELULA = 9;

const hex = (h: string): RGB => {
  const n = parseInt(h.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const C = {
  navy: hex("#0b2148"),
  azul: hex("#163a7a"),
  texto: hex("#0f172a"),
  muted: hex("#64748b"),
  borda: hex("#e2e8f0"),
  zebra: hex("#f8fafc"),
  fundoTitulo: hex("#f1f5f9"),
  branco: rgb(1, 1, 1),
};

/** Mesmas cores das colunas no quadro (Tailwind 500; slate 400). */
const COR_COLUNA: Record<string, string> = {
  slate: "#94a3b8",
  blue: "#3b82f6",
  violet: "#8b5cf6",
  amber: "#f59e0b",
  rose: "#f43f5e",
  emerald: "#10b981",
  cyan: "#06b6d4",
  orange: "#f97316",
};
const corColuna = (cor: string | null) => hex(COR_COLUNA[cor ?? ""] ?? "#94a3b8");

const COR_SITUACAO: Record<string, string> = {
  providencia_escritorio: "#f43f5e",
  cumprimento_pagamento: "#f59e0b",
  verificar_1grau: "#3b82f6",
  aguardando: "#94a3b8",
};

// ---------------------------------------------------------------------------
// Texto: Helvetica padrão só codifica WinAnsi (Latin-1 + alguns símbolos).
// ---------------------------------------------------------------------------
const WINANSI_EXTRA = new Set(
  Array.from("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ")
);

function pdfSafe(raw: string | null | undefined): string {
  if (!raw) return "";
  let out = "";
  for (const ch of raw.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, " ")) {
    const code = ch.codePointAt(0)!;
    if (ch === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WINANSI_EXTRA.has(ch)) {
      out += ch;
      continue;
    }
    if (ch === "→") out += "->";
    else if (ch === "≥") out += ">=";
    else if (ch === "≤") out += "<=";
    else {
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += base && base !== ch && [...base].every((b) => b.charCodeAt(0) < 0x7f) ? base : "";
    }
  }
  return out;
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  maxLines = MAX_LINHAS_CELULA
): string[] {
  const lines: string[] = [];
  for (const paragraph of pdfSafe(text).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (let word of words) {
      // Palavra maior que a coluna: quebra por caracteres.
      while (font.widthOfTextAtSize(word, size) > maxWidth) {
        let i = word.length - 1;
        while (i > 1 && font.widthOfTextAtSize(word.slice(0, i), size) > maxWidth) i--;
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(word.slice(0, i));
        word = word.slice(i);
      }
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    let last = cut[maxLines - 1];
    while (last && font.widthOfTextAtSize(`${last}…`, size) > maxWidth) {
      last = last.slice(0, -1);
    }
    cut[maxLines - 1] = `${last}…`;
    return cut;
  }
  return lines;
}

function dataBr(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function numeroProcesso(raw: string | null): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length === 20 ? formatNumeroProcesso(digits) : (raw ?? "").trim();
}

function plural(n: number, um: string, varios: string) {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

// ---------------------------------------------------------------------------
// Tabela: colunas dinâmicas (campos vazios em todo o relatório somem).
// ---------------------------------------------------------------------------
type Linha = { text: string; bold?: boolean; muted?: boolean; dot?: RGB };
type ColunaTabela = {
  titulo: string;
  peso?: number;
  largura?: number;
  alinhar?: "right";
  celula: (p: RelatorioProcessoItem, idx: number) => Linha[];
};

function colunasTabela(processos: RelatorioProcessoItem[]): ColunaTabela[] {
  const algum = (f: (p: RelatorioProcessoItem) => unknown) => processos.some((p) => Boolean(f(p)));

  const cols: ColunaTabela[] = [
    { titulo: "#", largura: 24, celula: (_p, i) => [{ text: String(i + 1), muted: true }] },
    {
      titulo: "Cliente",
      peso: 2.1,
      celula: (p) => [
        { text: p.nome?.trim() || "Sem nome", bold: true },
        ...(p.cpf ? [{ text: `CPF ${formatCpfCnpj(p.cpf)}`, muted: true }] : []),
      ],
    },
    {
      titulo: "Nº do processo",
      largura: 124,
      celula: (p) => [
        { text: numeroProcesso(p.numero_processo) || "—" },
        ...([p.vara_comarca, p.tribunal].filter(Boolean).length
          ? [{ text: [p.vara_comarca, p.tribunal].filter(Boolean).join(" · "), muted: true }]
          : []),
      ],
    },
  ];

  if (algum((p) => p.beneficio_identificado || p.tipo_acao || p.polo_passivo)) {
    cols.push({
      titulo: "Benefício / Ação",
      peso: 1.7,
      celula: (p) => {
        const out: Linha[] = [];
        const principal = p.beneficio_identificado || p.tipo_acao;
        if (principal) out.push({ text: principal });
        if (p.beneficio_identificado && p.tipo_acao) out.push({ text: p.tipo_acao, muted: true });
        if (p.polo_passivo) out.push({ text: `Réu: ${p.polo_passivo}`, muted: true });
        return out.length ? out : [{ text: "—", muted: true }];
      },
    });
  }
  if (algum((p) => p.parceiro_nome)) {
    cols.push({
      titulo: "Parceiro",
      peso: 0.9,
      celula: (p) => [{ text: p.parceiro_nome || "—", muted: !p.parceiro_nome }],
    });
  }
  cols.push({
    titulo: "Último andamento / observações",
    peso: 3,
    celula: (p) => {
      const out: Linha[] = [];
      const data = dataBr(p.ultimo_andamento_data);
      if (data) out.push({ text: data, bold: true });
      if (p.ultimo_movimento?.trim()) out.push({ text: p.ultimo_movimento.trim() });
      if (p.observacao?.trim()) out.push({ text: `Obs.: ${p.observacao.trim()}`, muted: true });
      return out.length ? out : [{ text: "Sem andamento registrado", muted: true }];
    },
  });
  if (algum((p) => p.situacao)) {
    cols.push({
      titulo: "Situação",
      peso: 1.05,
      celula: (p) => {
        const info = situacaoProcessoInfo(p.situacao);
        return info
          ? [{ text: info.label, dot: hex(COR_SITUACAO[info.value] ?? "#94a3b8") }]
          : [{ text: "—", muted: true }];
      },
    });
  }
  if (algum((p) => p.valor_centavos != null)) {
    cols.push({
      titulo: "Valor",
      largura: 78,
      alinhar: "right",
      celula: (p) => [
        p.valor_centavos != null
          ? { text: formatValorCentavos(p.valor_centavos), bold: true }
          : { text: "—", muted: true },
      ],
    });
  }
  return cols;
}

function larguras(cols: ColunaTabela[]): number[] {
  const fixo = cols.reduce((s, c) => s + (c.largura ?? 0), 0);
  const pesos = cols.reduce((s, c) => s + (c.largura ? 0 : c.peso ?? 1), 0);
  const livre = CONTENT_W - fixo;
  return cols.map((c) => c.largura ?? (livre * (c.peso ?? 1)) / pesos);
}

// ---------------------------------------------------------------------------
// Gerador
// ---------------------------------------------------------------------------
export type RelatorioPdfMeta = {
  escritorio: string;
  geradoPor: string;
  agora?: Date;
};

export function tituloEscopo(dados: RelatorioProcessosDados): string {
  if (dados.escopo.funil === "todos") return "Todos os funis";
  const funil = dados.funis[0];
  if (dados.escopo.coluna) {
    const col = funil.colunas[0];
    return `${funil.label} — ${col?.label ?? dados.escopo.coluna}`;
  }
  return `${funil.label} — todas as colunas`;
}

export async function gerarPdfRelatorioProcessos(
  dados: RelatorioProcessosDados,
  meta: RelatorioPdfMeta
): Promise<Uint8Array> {
  const agora = meta.agora ?? new Date();
  const geradoEm = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(agora);

  const pdf = await PDFDocument.create();
  const escopo = tituloEscopo(dados);
  pdf.setTitle(`Relatório de processos — ${escopo}`);
  pdf.setAuthor(meta.escritorio);
  pdf.setCreator("Painel do escritório");
  pdf.setCreationDate(agora);

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let logo: PDFImage | null = null;
  try {
    logo = await pdf.embedPng(await readFile(path.join(process.cwd(), "public", "FB.png")));
  } catch {
    logo = null;
  }

  const txt = (
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    opts: { size?: number; font?: PDFFont; color?: RGB } = {}
  ) =>
    page.drawText(pdfSafe(text), {
      x,
      y,
      size: opts.size ?? FONT_SIZE,
      font: opts.font ?? regular,
      color: opts.color ?? C.texto,
    });

  const textoDireita = (
    page: PDFPage,
    text: string,
    xDireita: number,
    y: number,
    opts: { size?: number; font?: PDFFont; color?: RGB } = {}
  ) => {
    const f = opts.font ?? regular;
    const s = opts.size ?? FONT_SIZE;
    txt(page, text, xDireita - f.widthOfTextAtSize(pdfSafe(text), s), y, opts);
  };

  // ---- páginas -----------------------------------------------------------
  let page!: PDFPage;
  let y = TOP;

  const novaPagina = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = TOP;
    // Cabeçalho
    page.drawRectangle({ x: 0, y: PAGE_H - 5, width: PAGE_W, height: 5, color: C.navy });
    const logoSize = 36;
    let xTexto = MARGIN_X;
    if (logo) {
      page.drawImage(logo, {
        x: MARGIN_X,
        y: PAGE_H - 14 - logoSize,
        width: logoSize,
        height: logoSize,
      });
      xTexto += logoSize + 10;
    }
    txt(page, meta.escritorio, xTexto, PAGE_H - 30, { size: 12.5, font: bold, color: C.navy });
    txt(page, `Relatório de processos · ${escopo}`, xTexto, PAGE_H - 44, {
      size: 8.5,
      color: C.muted,
    });
    textoDireita(page, `Gerado em ${geradoEm}`, PAGE_W - MARGIN_X, PAGE_H - 30, {
      size: 8,
      color: C.muted,
    });
    textoDireita(page, `por ${meta.geradoPor}`, PAGE_W - MARGIN_X, PAGE_H - 42, {
      size: 8,
      color: C.muted,
    });
    page.drawLine({
      start: { x: MARGIN_X, y: PAGE_H - HEADER_H + 4 },
      end: { x: PAGE_W - MARGIN_X, y: PAGE_H - HEADER_H + 4 },
      thickness: 0.8,
      color: C.borda,
    });
  };

  const garantirEspaco = (altura: number) => {
    if (y - altura < BOTTOM) {
      novaPagina();
      return true;
    }
    return false;
  };

  // ---- resumo (página 1) --------------------------------------------------
  novaPagina();
  txt(page, "Relatório de Processos", MARGIN_X, y - 20, { size: 22, font: bold, color: C.navy });
  y -= 36;
  txt(page, escopo, MARGIN_X, y - 4, { size: 11, color: C.azul });
  y -= 24;

  const todasColunas = dados.funis.flatMap((f) => f.colunas);
  const todosProcessos = todasColunas.flatMap((c) => c.processos);
  const comParceiro = todosProcessos.filter((p) => p.parceiro_nome).length;
  const valorTotal = todosProcessos.reduce((s, p) => s + (p.valor_centavos ?? 0), 0);
  const colunasComProcesso = todasColunas.filter((c) => c.processos.length).length;

  const semAndamento = todosProcessos.filter(
    (p) => !p.ultimo_movimento?.trim() && !p.ultimo_andamento_data
  ).length;

  const kpis: [string, string][] = [["Processos", dados.total.toLocaleString("pt-BR")]];
  if (!dados.escopo.coluna) {
    kpis.push(["Colunas com processos", `${colunasComProcesso} de ${todasColunas.length}`]);
  }
  kpis.push(["Com parceiro", comParceiro.toLocaleString("pt-BR")]);
  kpis.push(["Sem andamento registrado", semAndamento.toLocaleString("pt-BR")]);
  if (valorTotal > 0) kpis.push(["Valor total", formatValorCentavos(valorTotal)]);

  const gap = 10;
  const kpiW = (CONTENT_W - gap * (kpis.length - 1)) / kpis.length;
  const kpiH = 50;
  kpis.forEach(([rotulo, valor], i) => {
    const x = MARGIN_X + i * (kpiW + gap);
    page.drawRectangle({
      x,
      y: y - kpiH,
      width: kpiW,
      height: kpiH,
      color: C.fundoTitulo,
      borderColor: C.borda,
      borderWidth: 0.6,
    });
    page.drawRectangle({ x, y: y - kpiH, width: 3, height: kpiH, color: C.navy });
    txt(page, rotulo.toUpperCase(), x + 12, y - 16, { size: 7, font: bold, color: C.muted });
    txt(page, valor, x + 12, y - 38, { size: 17, font: bold, color: C.navy });
  });
  y -= kpiH + 24;

  // Distribuição por coluna (com uma coluna só seria uma barra de 100%)
  for (const funil of dados.escopo.coluna ? [] : dados.funis) {
    const totalFunil = funil.colunas.reduce((s, c) => s + c.processos.length, 0);
    garantirEspaco(40 + funil.colunas.length * 18);
    txt(page, funil.label, MARGIN_X, y - 10, { size: 11, font: bold, color: C.navy });
    textoDireita(page, plural(totalFunil, "processo", "processos"), PAGE_W - MARGIN_X, y - 10, {
      size: 9,
      color: C.muted,
    });
    y -= 18;
    page.drawLine({
      start: { x: MARGIN_X, y },
      end: { x: PAGE_W - MARGIN_X, y },
      thickness: 0.6,
      color: C.borda,
    });
    y -= 4;

    const barraX = MARGIN_X + 300;
    const barraW = CONTENT_W - 300 - 110;
    for (const col of funil.colunas) {
      garantirEspaco(18);
      const n = col.processos.length;
      const pct = totalFunil ? n / totalFunil : 0;
      const cy = y - 12;
      page.drawCircle({ x: MARGIN_X + 5, y: cy + 3, size: 3.5, color: corColuna(col.cor) });
      txt(page, col.label, MARGIN_X + 15, cy, { size: 9, color: n ? C.texto : C.muted });
      page.drawRectangle({ x: barraX, y: cy - 1, width: barraW, height: 8, color: C.fundoTitulo });
      if (n) {
        page.drawRectangle({
          x: barraX,
          y: cy - 1,
          width: Math.max(2, barraW * pct),
          height: 8,
          color: corColuna(col.cor),
        });
      }
      textoDireita(page, n.toLocaleString("pt-BR"), PAGE_W - MARGIN_X - 46, cy, {
        size: 9,
        font: bold,
        color: n ? C.texto : C.muted,
      });
      textoDireita(page, `${Math.round(pct * 100)}%`, PAGE_W - MARGIN_X, cy, {
        size: 9,
        color: C.muted,
      });
      y -= 18;
    }
    y -= 14;
  }

  if (dados.total === 0) {
    garantirEspaco(30);
    txt(page, "Nenhum processo encontrado para este filtro.", MARGIN_X, y - 12, {
      size: 10,
      color: C.muted,
    });
  }

  // ---- seções por coluna ---------------------------------------------------
  const secoes = dados.funis.flatMap((f) =>
    f.colunas.filter((c) => c.processos.length).map((c) => ({ funil: f.label, coluna: c }))
  );
  const umaSecao = secoes.length === 1;

  for (const { funil, coluna } of secoes) {
    // Coluna única cabe logo abaixo do resumo; várias = cada uma em página própria.
    if (umaSecao) garantirEspaco(120);
    else novaPagina();
    desenharSecao(funil, coluna, false);
  }

  function desenharTituloSecao(funil: string, coluna: RelatorioColuna, continuacao: boolean) {
    const h = 34;
    page.drawRectangle({
      x: MARGIN_X,
      y: y - h,
      width: CONTENT_W,
      height: h,
      color: C.fundoTitulo,
    });
    page.drawRectangle({ x: MARGIN_X, y: y - h, width: 5, height: h, color: corColuna(coluna.cor) });
    txt(page, `${coluna.label}${continuacao ? " (continuação)" : ""}`, MARGIN_X + 14, y - 15, {
      size: 13,
      font: bold,
      color: C.navy,
    });
    txt(page, funil, MARGIN_X + 14, y - 27, { size: 8, color: C.muted });
    textoDireita(
      page,
      plural(coluna.processos.length, "processo", "processos"),
      PAGE_W - MARGIN_X - 12,
      y - 21,
      { size: 10, font: bold, color: C.navy }
    );
    y -= h + 8;
  }

  function desenharSecao(funil: string, coluna: RelatorioColuna, continuacao: boolean) {
    desenharTituloSecao(funil, coluna, continuacao);
    const cols = colunasTabela(coluna.processos);
    const ws = larguras(cols);

    const cabecalhoTabela = () => {
      const h = 18;
      page.drawRectangle({ x: MARGIN_X, y: y - h, width: CONTENT_W, height: h, color: C.navy });
      let x = MARGIN_X;
      cols.forEach((c, i) => {
        const t = c.titulo.toUpperCase();
        if (c.alinhar === "right") {
          textoDireita(page, t, x + ws[i] - CELL_PAD_X, y - 12, { size: 7, font: bold, color: C.branco });
        } else {
          txt(page, t, x + CELL_PAD_X, y - 12, { size: 7, font: bold, color: C.branco });
        }
        x += ws[i];
      });
      y -= h;
    };
    cabecalhoTabela();

    coluna.processos.forEach((p, idx) => {
      // Quebra o conteúdo de cada célula em linhas para saber a altura da linha.
      const celulas = cols.map((c, i) => {
        const largura = ws[i] - CELL_PAD_X * 2 - 0.5;
        return c.celula(p, idx).flatMap((linha) => {
          const font = linha.bold ? bold : regular;
          const recuo = linha.dot ? 9 : 0;
          return wrapText(linha.text, font, FONT_SIZE, largura - recuo).map((t, j) => ({
            ...linha,
            text: t,
            dot: j === 0 ? linha.dot : undefined,
            recuo,
          }));
        });
      });
      const nLinhas = Math.max(1, ...celulas.map((l) => l.length));
      const h = nLinhas * LINE_H + CELL_PAD_Y * 2;

      if (y - h < BOTTOM) {
        novaPagina();
        desenharTituloSecao(funil, coluna, true);
        cabecalhoTabela();
      }

      if (idx % 2 === 1) {
        page.drawRectangle({ x: MARGIN_X, y: y - h, width: CONTENT_W, height: h, color: C.zebra });
      }
      let x = MARGIN_X;
      celulas.forEach((linhas, i) => {
        linhas.forEach((l, j) => {
          const ty = y - CELL_PAD_Y - FONT_SIZE - j * LINE_H + 1;
          const font = l.bold ? bold : regular;
          const color = l.muted ? C.muted : C.texto;
          if (cols[i].alinhar === "right") {
            textoDireita(page, l.text, x + ws[i] - CELL_PAD_X, ty, { font, color });
          } else {
            if (l.dot) page.drawCircle({ x: x + CELL_PAD_X + 3, y: ty + 2.8, size: 3, color: l.dot });
            txt(page, l.text, x + CELL_PAD_X + l.recuo, ty, { font, color });
          }
        });
        x += ws[i];
      });
      y -= h;
      page.drawLine({
        start: { x: MARGIN_X, y },
        end: { x: PAGE_W - MARGIN_X, y },
        thickness: 0.5,
        color: C.borda,
      });
    });
    y -= 16;
  }

  // ---- rodapé com total de páginas ------------------------------------------
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    pg.drawLine({
      start: { x: MARGIN_X, y: FOOTER_H },
      end: { x: PAGE_W - MARGIN_X, y: FOOTER_H },
      thickness: 0.6,
      color: C.borda,
    });
    txt(pg, `${meta.escritorio} · Documento interno e confidencial`, MARGIN_X, FOOTER_H - 13, {
      size: 7.5,
      color: C.muted,
    });
    textoDireita(pg, `Página ${i + 1} de ${pages.length}`, PAGE_W - MARGIN_X, FOOTER_H - 13, {
      size: 7.5,
      font: bold,
      color: C.muted,
    });
  });

  return pdf.save();
}

export function nomeArquivoRelatorio(dados: RelatorioProcessosDados, agora = new Date()): string {
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
  const partes = ["relatorio-processos", dados.escopo.funil, dados.escopo.coluna, dia]
    .filter(Boolean)
    .map((s) => String(s).replace(/[^a-z0-9-]+/gi, "-"));
  return `${partes.join("_")}.pdf`;
}
