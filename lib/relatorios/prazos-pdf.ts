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
import type { PrazoEnriched } from "@/components/prazos/prazos-ui";
import { diasAte, tipoPrazoLabel } from "@/lib/prazos/filtro";
import { dataBr, hex, pdfSafe, wrapText } from "@/lib/relatorios/processos-pdf";
import {
  TITULO_MODO,
  type RelatorioPrazosDados,
} from "@/lib/relatorios/prazos-dados";
import { formatCpfCnpj } from "@/lib/utils/cpf";
import { formatNumeroProcesso } from "@/lib/utils/processo";
import { formatValorCentavos } from "@/lib/utils/processos";

// Mesmo layout do relatório de processos (A4 paisagem, pontos).
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
const MAX_LINHAS = 6;

const C = {
  navy: hex("#0b2148"),
  azul: hex("#163a7a"),
  texto: hex("#0f172a"),
  muted: hex("#64748b"),
  borda: hex("#e2e8f0"),
  zebra: hex("#f8fafc"),
  fundoTitulo: hex("#f1f5f9"),
  vermelho: hex("#dc2626"),
  ambar: hex("#d97706"),
  verde: hex("#059669"),
  branco: rgb(1, 1, 1),
};

function plural(n: number, um: string, varios: string) {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

function numeroProcesso(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length === 20 ? formatNumeroProcesso(digits) : (raw ?? "").trim();
}

function situacaoItem(
  p: PrazoEnriched,
  modo: RelatorioPrazosDados["modo"],
  todayIso: string
): { text: string; cor: RGB } {
  if (p.concluido) {
    const quando = dataBr(p.concluido_em);
    const rotulo = modo === "pagamentos" ? "Pago" : "Concluído";
    return { text: quando ? `${rotulo} em ${quando}` : rotulo, cor: C.verde };
  }
  const dias = diasAte(p.data_prazo, todayIso);
  if (dias < 0) {
    return { text: `${plural(-dias, "dia", "dias")} de atraso`, cor: C.vermelho };
  }
  if (dias === 0) return { text: "Hoje", cor: C.ambar };
  return { text: `Em ${plural(dias, "dia", "dias")}`, cor: C.navy };
}

type Linha = { text: string; bold?: boolean; muted?: boolean; cor?: RGB };
type Coluna = {
  titulo: string;
  peso?: number;
  largura?: number;
  alinhar?: "right";
  celula: (p: PrazoEnriched, idx: number) => Linha[];
};

function colunas(dados: RelatorioPrazosDados): Coluna[] {
  const { modo, todayIso, itens } = dados;
  const algum = (f: (p: PrazoEnriched) => unknown) => itens.some((p) => Boolean(f(p)));

  const cols: Coluna[] = [
    { titulo: "#", largura: 24, celula: (_p, i) => [{ text: String(i + 1), muted: true }] },
    {
      titulo: "Data",
      largura: 62,
      celula: (p) => [
        { text: dataBr(p.data_prazo), bold: true },
        ...(p.hora_prazo ? [{ text: p.hora_prazo.slice(0, 5), muted: true }] : []),
      ],
    },
    {
      titulo: "Situação",
      largura: 92,
      celula: (p) => {
        const s = situacaoItem(p, modo, todayIso);
        return [{ text: s.text, bold: true, cor: s.cor }];
      },
    },
    {
      titulo: "Cliente",
      peso: 1.7,
      celula: (p) => [
        { text: p.cliente_nome?.trim() || "Sem cliente vinculado", bold: true, muted: !p.cliente_nome },
        ...(p.cpf ? [{ text: `CPF ${formatCpfCnpj(p.cpf)}`, muted: true }] : []),
      ],
    },
    {
      titulo: modo === "pagamentos" ? "Pagamento" : modo === "audiencias" ? "Audiência" : "Prazo",
      peso: 2.4,
      celula: (p) => {
        const out: Linha[] = [{ text: p.titulo }];
        if (modo === "prazos") out.push({ text: tipoPrazoLabel(p.tipo), muted: true });
        if (p.descricao?.trim()) out.push({ text: p.descricao.trim(), muted: true });
        return out;
      },
    },
  ];

  if (modo === "audiencias" && algum((p) => p.local || p.modalidade || p.link_audiencia)) {
    cols.push({
      titulo: "Local",
      peso: 1.5,
      celula: (p) => {
        const out: Linha[] = [];
        if (p.modalidade) out.push({ text: p.modalidade === "virtual" ? "Virtual" : "Presencial", bold: true });
        if (p.local) out.push({ text: p.local });
        if (p.link_audiencia) out.push({ text: p.link_audiencia, muted: true });
        return out.length ? out : [{ text: "—", muted: true }];
      },
    });
  }

  if (algum((p) => p.numero_processo || p.parceiro_nome)) {
    cols.push({
      titulo: "Processo",
      largura: 128,
      celula: (p) => [
        { text: numeroProcesso(p.numero_processo) || "—", muted: !p.numero_processo },
        ...(p.parceiro_nome ? [{ text: `Parceiro: ${p.parceiro_nome}`, muted: true }] : []),
      ],
    });
  }

  if (modo === "pagamentos" || algum((p) => p.valor_centavos != null)) {
    cols.push({
      titulo: "Valor",
      largura: 80,
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

function larguras(cols: Coluna[]): number[] {
  const fixo = cols.reduce((s, c) => s + (c.largura ?? 0), 0);
  const pesos = cols.reduce((s, c) => s + (c.largura ? 0 : c.peso ?? 1), 0);
  const livre = CONTENT_W - fixo;
  return cols.map((c) => c.largura ?? (livre * (c.peso ?? 1)) / pesos);
}

export function tituloRelatorioPrazos(dados: RelatorioPrazosDados): string {
  return `Relatório de ${TITULO_MODO[dados.modo]}`;
}

export async function gerarPdfRelatorioPrazos(
  dados: RelatorioPrazosDados,
  meta: { escritorio: string; geradoPor: string; agora?: Date }
): Promise<Uint8Array> {
  const agora = meta.agora ?? new Date();
  const geradoEm = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(agora);
  const titulo = tituloRelatorioPrazos(dados);
  const escopo = dados.filtros.join(" · ");

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${titulo} — ${escopo}`);
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

  let page!: PDFPage;
  let y = TOP;
  const novaPagina = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = TOP;
    page.drawRectangle({ x: 0, y: PAGE_H - 5, width: PAGE_W, height: 5, color: C.navy });
    const logoSize = 36;
    let xTexto = MARGIN_X;
    if (logo) {
      page.drawImage(logo, { x: MARGIN_X, y: PAGE_H - 14 - logoSize, width: logoSize, height: logoSize });
      xTexto += logoSize + 10;
    }
    txt(page, meta.escritorio, xTexto, PAGE_H - 30, { size: 12.5, font: bold, color: C.navy });
    const sub = wrapText(`${titulo} · ${escopo}`, regular, 8.5, PAGE_W - xTexto - 200, 1)[0] ?? "";
    txt(page, sub, xTexto, PAGE_H - 44, { size: 8.5, color: C.muted });
    textoDireita(page, `Gerado em ${geradoEm}`, PAGE_W - MARGIN_X, PAGE_H - 30, { size: 8, color: C.muted });
    textoDireita(page, `por ${meta.geradoPor}`, PAGE_W - MARGIN_X, PAGE_H - 42, { size: 8, color: C.muted });
    page.drawLine({
      start: { x: MARGIN_X, y: PAGE_H - HEADER_H + 4 },
      end: { x: PAGE_W - MARGIN_X, y: PAGE_H - HEADER_H + 4 },
      thickness: 0.8,
      color: C.borda,
    });
  };

  // ---- resumo --------------------------------------------------------------
  novaPagina();
  txt(page, titulo, MARGIN_X, y - 20, { size: 22, font: bold, color: C.navy });
  y -= 36;
  for (const linha of wrapText(escopo, regular, 11, CONTENT_W, 2)) {
    txt(page, linha, MARGIN_X, y - 4, { size: 11, color: C.azul });
    y -= 15;
  }
  y -= 9;

  const { resumo, modo } = dados;
  const kpis: [string, string, RGB][] = [
    [modo === "pagamentos" ? "Pagamentos" : modo === "audiencias" ? "Audiências" : "Prazos", resumo.total.toLocaleString("pt-BR"), C.navy],
    [modo === "audiencias" ? "Passadas sem conclusão" : "Atrasados", resumo.atrasados.toLocaleString("pt-BR"), resumo.atrasados ? C.vermelho : C.navy],
  ];
  if (resumo.atrasados) {
    kpis.push(["Maior atraso", plural(resumo.maiorAtraso, "dia", "dias"), C.vermelho]);
  }
  if (modo === "pagamentos" || resumo.valorTotal > 0) {
    kpis.push(["Valor total", formatValorCentavos(resumo.valorTotal), C.navy]);
    if (resumo.valorAtrasado > 0) {
      kpis.push(["Valor em atraso", formatValorCentavos(resumo.valorAtrasado), C.vermelho]);
    }
  }
  const gap = 10;
  const kpiW = (CONTENT_W - gap * (kpis.length - 1)) / kpis.length;
  const kpiH = 50;
  kpis.forEach(([rotulo, valor, cor], i) => {
    const x = MARGIN_X + i * (kpiW + gap);
    page.drawRectangle({ x, y: y - kpiH, width: kpiW, height: kpiH, color: C.fundoTitulo, borderColor: C.borda, borderWidth: 0.6 });
    page.drawRectangle({ x, y: y - kpiH, width: 3, height: kpiH, color: cor });
    txt(page, rotulo.toUpperCase(), x + 12, y - 16, { size: 7, font: bold, color: C.muted });
    txt(page, valor, x + 12, y - 38, { size: 17, font: bold, color: cor });
  });
  y -= kpiH + 24;

  if (!dados.itens.length) {
    txt(page, "Nada encontrado para este filtro.", MARGIN_X, y - 12, { size: 10, color: C.muted });
  } else {
    // ---- tabela ------------------------------------------------------------
    const cols = colunas(dados);
    const ws = larguras(cols);
    const cabecalho = () => {
      const h = 18;
      page.drawRectangle({ x: MARGIN_X, y: y - h, width: CONTENT_W, height: h, color: C.navy });
      let x = MARGIN_X;
      cols.forEach((c, i) => {
        const t = c.titulo.toUpperCase();
        if (c.alinhar === "right") textoDireita(page, t, x + ws[i] - CELL_PAD_X, y - 12, { size: 7, font: bold, color: C.branco });
        else txt(page, t, x + CELL_PAD_X, y - 12, { size: 7, font: bold, color: C.branco });
        x += ws[i];
      });
      y -= h;
    };
    cabecalho();

    dados.itens.forEach((p, idx) => {
      const celulas = cols.map((c, i) =>
        c.celula(p, idx).flatMap((linha) =>
          wrapText(linha.text, linha.bold ? bold : regular, FONT_SIZE, ws[i] - CELL_PAD_X * 2 - 0.5, MAX_LINHAS).map(
            (t) => ({ ...linha, text: t })
          )
        )
      );
      const h = Math.max(1, ...celulas.map((l) => l.length)) * LINE_H + CELL_PAD_Y * 2;
      if (y - h < BOTTOM) {
        novaPagina();
        cabecalho();
      }
      if (idx % 2 === 1) {
        page.drawRectangle({ x: MARGIN_X, y: y - h, width: CONTENT_W, height: h, color: C.zebra });
      }
      let x = MARGIN_X;
      celulas.forEach((linhas, i) => {
        linhas.forEach((l, j) => {
          const ty = y - CELL_PAD_Y - FONT_SIZE - j * LINE_H + 1;
          const font = l.bold ? bold : regular;
          const color = l.cor ?? (l.muted ? C.muted : C.texto);
          if (cols[i].alinhar === "right") textoDireita(page, l.text, x + ws[i] - CELL_PAD_X, ty, { font, color });
          else txt(page, l.text, x + CELL_PAD_X, ty, { font, color });
        });
        x += ws[i];
      });
      y -= h;
      page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 0.5, color: C.borda });
    });

    // Total ao fim da tabela (pagamentos)
    if (modo === "pagamentos" && resumo.valorTotal > 0) {
      if (y - 22 < BOTTOM) novaPagina();
      y -= 16;
      textoDireita(page, `Total: ${formatValorCentavos(resumo.valorTotal)}`, PAGE_W - MARGIN_X - CELL_PAD_X, y, {
        size: 10,
        font: bold,
        color: C.navy,
      });
    }
  }

  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: MARGIN_X, y: FOOTER_H }, end: { x: PAGE_W - MARGIN_X, y: FOOTER_H }, thickness: 0.6, color: C.borda });
    txt(pg, `${meta.escritorio} · Documento interno e confidencial`, MARGIN_X, FOOTER_H - 13, { size: 7.5, color: C.muted });
    textoDireita(pg, `Página ${i + 1} de ${pages.length}`, PAGE_W - MARGIN_X, FOOTER_H - 13, { size: 7.5, font: bold, color: C.muted });
  });

  return pdf.save();
}

export function nomeArquivoRelatorioPrazos(dados: RelatorioPrazosDados, agora = new Date()): string {
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
  const partes = ["relatorio", dados.modo, dados.situacao !== "todos" ? dados.situacao : null, dia]
    .filter(Boolean)
    .map((s) => String(s).replace(/[^a-z0-9-]+/gi, "-"));
  return `${partes.join("_")}.pdf`;
}
