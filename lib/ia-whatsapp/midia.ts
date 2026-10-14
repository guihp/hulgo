import "server-only";

import { detectarFormatoDocumento, extrairTextoDocumento } from "@/lib/documentos/extrair-texto";
import { imagemParaVisao } from "@/lib/openai/imagem";
import {
  openaiChatCompletions,
  openaiExtractDocumentText,
  openaiTranscribeAudio,
} from "@/lib/openai/sandbox";
import type { Tables } from "@/types/database";

type Mensagem = Tables<"mensagens">;

const MAX_BYTES = 20 * 1024 * 1024;

/** Mesmo extrator do fluxo n8n ("Analisar a imagem" / "Message a model"). */
const PROMPT_EXTRATOR = `Você é um extrator de dados de documentos para um escritório de advocacia previdenciária (INSS). O cliente enviou este arquivo pelo WhatsApp. Responda em português, EXATAMENTE neste formato:

TIPO: <RG | CNH | CPF | Certidão de Nascimento | Certidão de Casamento | Certidão de Óbito | Certidão Eleitoral | Comprovante de Residência | CNIS | CTPS | Carnê de Contribuição | Laudo Médico | Atestado Médico | Exame | Receita Médica | Carta de Concessão/Indeferimento do INSS | DAP/CAF | Declaração de Sindicato | Nota Fiscal de Produtor Rural | Contrato | Procuração | Cartão do CadÚnico | Resumo CadÚnico | Requerimento do LOAS assinado | Termo | Foto de Pessoa | Foto de Local/Atividade Rural | Print de Tela | Outro (especifique)>

DADOS EXTRAÍDOS: todos os dados legíveis, um por linha "Campo: valor". Priorize:
- Nome completo de todas as pessoas citadas (titular, pai, mãe, cônjuge, falecido, médico)
- CPF, RG, NIT/PIS, número de benefício (NB), número de processo
- Datas: nascimento, casamento, óbito, emissão, atendimento, vínculos (admissão/saída)
- Órgão emissor, cartório, cidade/UF
- Laudos/atestados: CID, diagnóstico por extenso, nome e CRM do médico, período de afastamento, se declara incapacidade
- CNIS/CTPS: cada vínculo com empregador e período
- Documentos rurais (DAP/CAF, sindicato, notas): nome do agricultor, município, período/validade, atividade declarada
- Comprovante de residência: nome, endereço completo, mês de referência
- Endereços e telefones visíveis

QUALIDADE: <legível | parcialmente legível (diga o que não deu para ler) | ilegível | cortada | foto tremida>

OBSERVAÇÕES: <documento antigo, rasurado, assinado ou não, carimbo, frente ou verso; se for foto de pessoa/atividade rural, descreva a cena>

REGRAS:
- Transcreva números EXATAMENTE como aparecem. NÃO invente nem complete dígitos ilegíveis — escreva [ilegível].
- Mais de um documento no mesmo arquivo: liste cada um (TIPO 1, TIPO 2...).
- Se não for documento (foto comum, meme, print de conversa), diga o que é e descreva brevemente.
- Não dê opinião jurídica nem diga se o documento "serve".
- Preste atenção nos títulos para ter certeza do que foi enviado.`;

async function baixar(url: string): Promise<Buffer> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Download da mídia falhou (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("Arquivo maior que 20 MB");
  return buf;
}

function nomeDoArquivo(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "arquivo");
  } catch {
    return "arquivo";
  }
}

function mimePorExtensao(nome: string): string {
  const ext = nome.toLowerCase().split(".").pop() ?? "";
  const mapa: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    ogg: "audio/ogg",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    mp4: "video/mp4",
    txt: "text/plain",
  };
  return mapa[ext] ?? "application/octet-stream";
}

async function descreverImagem(bytes: Buffer, nome: string, legenda: string): Promise<string> {
  const dataUrl = await imagemParaVisao({ bytes, mimeType: mimePorExtensao(nome), fileName: nome });
  return openaiChatCompletions([
    { role: "system", content: PROMPT_EXTRATOR },
    {
      role: "user",
      content: [
        { type: "text", text: legenda ? `Legenda do cliente: ${legenda}` : "Analise a imagem." },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ]);
}

async function descreverDocumento(bytes: Buffer, nome: string): Promise<string> {
  const mime = mimePorExtensao(nome);
  let texto: string | null = null;
  if (mime.startsWith("text/")) texto = bytes.toString("utf8").trim() || null;
  else if (detectarFormatoDocumento(bytes, nome, mime)) {
    texto = await extrairTextoDocumento({ bytes, fileName: nome, mimeType: mime }).catch(() => null);
  }

  if (texto) {
    return openaiChatCompletions([
      { role: "system", content: PROMPT_EXTRATOR },
      {
        role: "user",
        content: `Arquivo: ${nome}\n\nTexto extraído do arquivo:\n${texto.slice(0, 40_000)}`,
      },
    ]);
  }

  if (mime === "application/pdf") {
    // PDF escaneado: o modelo lê as páginas.
    return openaiChatCompletions([
      { role: "system", content: PROMPT_EXTRATOR },
      {
        role: "user",
        content: [
          { type: "text", text: `Arquivo: ${nome}` },
          {
            type: "file",
            file: {
              filename: nome,
              file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
            },
          },
        ],
      },
    ]);
  }

  // .doc/.xls antigos e afins
  return openaiExtractDocumentText({ bytes, fileName: nome, mimeType: mime });
}

// ---------------------------------------------------------------- endereço

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = process.env.LOCATIONIQ_API_KEY?.trim();
  if (!key) return null;
  const url = `https://us1.locationiq.com/v1/reverse?lat=${lat}&lon=${lng}&format=json&key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { address?: Record<string, string> } | null;
  const a = body?.address;
  if (!a) return null;
  const partes = [
    a.road,
    a.house_number,
    a.suburb || a.neighbourhood,
    a.city || a.town || a.municipality,
    a.state,
    a.postcode,
  ].filter(Boolean);
  return partes.length ? partes.join(", ") : null;
}

const MAPS_RE = /(https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.com\/maps|maps\.google\.com)[^\s]*)/i;

/** Link do Google Maps no texto → nota com o endereço para a IA (port do nó "Formatar endereço"). */
async function notaLinkMaps(texto: string): Promise<string | null> {
  const link = texto.match(MAPS_RE)?.[1];
  if (!link) return null;
  let destino = link;
  try {
    const res = await fetch(link, { redirect: "manual" });
    destino = res.headers.get("location") || link;
  } catch {
    // usa o próprio link
  }

  const q = destino.match(/[?&]q=([^&]+)/)?.[1];
  if (q) {
    const decodificado = decodeURIComponent(q.replace(/\+/g, " "));
    if (!/^-?\d+\.\d+,-?\d+\.\d+$/.test(decodificado.trim()) && decodificado.length > 5) {
      return `[LINK DO MAPS — endereço: ${decodificado}. Peça o que ainda falta (complemento, referência).]`;
    }
  }

  const padroes = [
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&]destination=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
  ];
  for (const re of padroes) {
    const m = destino.match(re);
    if (!m) continue;
    const endereco = await reverseGeocode(Number(m[1]), Number(m[2]));
    if (endereco) {
      return `[LINK DO MAPS — endereço aproximado: ${endereco}. Peça número e complemento para confirmar.]`;
    }
    break;
  }
  return "[LINK DO MAPS — não foi possível identificar o endereço. Peça para digitar rua, número, bairro e complemento.]";
}

// ---------------------------------------------------------------- principal

/** Texto que a IA recebe para esta mensagem do cliente. */
export async function conteudoParaIA(m: Mensagem): Promise<string> {
  const tipo = (m.mensage_type ?? "text").toLowerCase();
  const texto = (m.text ?? "").trim();
  const url = m.conteudo_media;

  if (tipo === "text") {
    const nota = await notaLinkMaps(texto).catch(() => null);
    return nota ? `${texto}\n${nota}` : texto;
  }

  if (tipo === "location") {
    let loc: { lat?: number; lng?: number; name?: string; address?: string } = {};
    try {
      loc = JSON.parse(texto);
    } catch {
      // segue sem coordenadas
    }
    const endereco =
      loc.address ||
      (loc.lat != null && loc.lng != null ? await reverseGeocode(loc.lat, loc.lng) : null) ||
      (loc.lat != null ? `coordenadas ${loc.lat}, ${loc.lng}` : "sem endereço");
    return `[LOCALIZAÇÃO ENVIADA — peça número, complemento e referência que faltam]: ${endereco}`;
  }

  if (tipo === "contact") {
    return `[CONTATO COMPARTILHADO]: ${texto}`;
  }

  if (tipo === "sticker") return "[FIGURINHA]";

  if (!url) {
    return `[${tipo.toUpperCase()} ENVIADO, mas o arquivo não chegou ao sistema. Peça para reenviar.]${texto ? ` Legenda: ${texto}` : ""}`;
  }

  const nome = nomeDoArquivo(url);
  const legenda = texto ? `\nLegenda do cliente: ${texto}` : "";

  try {
    const bytes = await baixar(url);
    if (tipo === "image") {
      const desc = await descreverImagem(bytes, nome, texto);
      return `[IMAGEM ENVIADA] url_media: ${url}${legenda}\n${desc}`;
    }
    if (tipo === "audio") {
      const t = await openaiTranscribeAudio({ bytes, fileName: nome, mimeType: mimePorExtensao(nome) });
      return `[ÁUDIO TRANSCRITO]: ${t}`;
    }
    if (tipo === "video") {
      const t = await openaiTranscribeAudio({ bytes, fileName: nome, mimeType: "video/mp4" }).catch(
        () => null
      );
      return `[VÍDEO ENVIADO] url_media: ${url}${legenda}\n(Só o áudio do vídeo é analisado; as imagens não.)\nÁudio: ${t?.trim() || "sem fala identificada"}`;
    }
    const desc = await descreverDocumento(bytes, nome);
    return `[DOCUMENTO ENVIADO: ${nome}] url_media: ${url}${legenda}\n${desc}`;
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "erro";
    if (tipo === "audio") {
      return `[ÁUDIO — não foi possível ouvir (${motivo}). Peça com educação para o cliente digitar.]`;
    }
    return `[${tipo.toUpperCase()} ENVIADO] url_media: ${url}${legenda}\n(Não foi possível analisar o conteúdo: ${motivo})`;
  }
}
