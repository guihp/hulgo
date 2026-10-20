/**
 * Webhook da EvoGo (evento "Message") → mensagem normalizada.
 * Formato: { event, instanceName, instanceToken, data: { Info: {...}, Message: {...} } }
 * Mídia vem em data.Message.base64 (a instância precisa estar com base64 ligado).
 */

import { normalizarTelefone } from "@/lib/ia-whatsapp/config";

export type TipoMensagemRecebida =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "ignorar";

export type MensagemRecebida = {
  instancia: string | null;
  id: string;
  chat: string;
  /** Telefone do contato (conversa privada) — dígitos normalizados. */
  telefone: string;
  /** JID "@s.whatsapp.net" do contato (conversa privada); "" se só veio @lid. */
  jid: string;
  /** Quem enviou (em grupo é o participante) — dígitos normalizados. */
  remetente: string;
  ehGrupo: boolean;
  /** Enviada pelo próprio número do escritório (celular/WhatsApp Web). */
  doEscritorio: boolean;
  nome: string;
  tipo: TipoMensagemRecebida;
  texto: string;
  mime: string | null;
  nomeArquivo: string | null;
  base64: string | null;
  localizacao: { lat: number; lng: number; nome: string | null; endereco: string | null } | null;
  contato: { nome: string; telefone: string } | null;
};

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function pick(o: Obj | null, ...keys: string[]): unknown {
  if (!o) return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

/** Remove invólucros (efêmera, visualização única, editada). */
function desembrulhar(message: Obj | null): Obj | null {
  let m = message;
  for (let i = 0; i < 4 && m; i++) {
    const inner =
      obj(pick(obj(m.ephemeralMessage), "message")) ??
      obj(pick(obj(m.viewOnceMessage), "message")) ??
      obj(pick(obj(m.viewOnceMessageV2), "message")) ??
      obj(pick(obj(m.viewOnceMessageV2Extension), "message")) ??
      obj(pick(obj(m.documentWithCaptionMessage), "message"));
    if (!inner) break;
    m = { ...inner, base64: m.base64 ?? inner.base64 };
  }
  return m;
}

/** JID real do contato: o próprio, ou o *Alt quando o chat vem como "@lid". */
function jidReal(jid: string, alternativos: string[]): string {
  const real = jid.endsWith("@s.whatsapp.net")
    ? jid
    : alternativos.find((a) => a.endsWith("@s.whatsapp.net")) ?? "";
  return real.replace(/:\d+@/, "@"); // tira o sufixo de aparelho ("5598...:12@")
}

/** JID → telefone. Para "@lid" usa o campo *Alt, que traz o número real. */
function telefoneDoJid(jid: string, alternativos: string[]): string {
  if (jid && !jid.endsWith("@lid")) return normalizarTelefone(jid);
  const real = alternativos.find((a) => a.endsWith("@s.whatsapp.net"));
  return real ? normalizarTelefone(real) : normalizarTelefone(jid);
}

export function parseEvogoWebhook(body: unknown): MensagemRecebida | null {
  const root = obj(body);
  if (!root) return null;
  const evento = str(pick(root, "event", "Event")).toLowerCase();
  if (evento && evento !== "message") return null;

  const data = obj(root.data);
  const info = obj(pick(data, "Info", "info"));
  if (!data || !info) return null;

  const message = desembrulhar(obj(pick(data, "Message", "message")));
  if (!message) return null;

  const chat = str(info.Chat);
  const ehGrupo = Boolean(info.IsGroup) || chat.endsWith("@g.us");
  const doEscritorio = info.IsFromMe === true || str(info.IsFromMe) === "true";
  const senderAlt = str(info.SenderAlt);
  const recipientAlt = str(info.RecipientAlt);
  const sender = str(info.Sender);

  const telefone = ehGrupo
    ? ""
    : telefoneDoJid(chat, doEscritorio ? [recipientAlt, senderAlt] : [senderAlt, sender, recipientAlt]);
  const remetente = telefoneDoJid(sender, [senderAlt]);
  const jid = ehGrupo
    ? ""
    : jidReal(chat, doEscritorio ? [recipientAlt, senderAlt] : [senderAlt, sender, recipientAlt]);

  const base64 = str(pick(message, "base64") ?? pick(data, "base64")) || null;

  const base: MensagemRecebida = {
    instancia: str(pick(root, "instanceName")) || null,
    id: str(info.ID),
    chat,
    telefone,
    jid,
    remetente,
    ehGrupo,
    doEscritorio,
    nome: str(info.PushName).trim(),
    tipo: "ignorar",
    texto: "",
    mime: null,
    nomeArquivo: null,
    base64,
    localizacao: null,
    contato: null,
  };

  const texto =
    str(message.conversation) || str(pick(obj(message.extendedTextMessage), "text"));
  if (texto) return { ...base, tipo: "text", texto };

  const midias: [string, TipoMensagemRecebida][] = [
    ["imageMessage", "image"],
    ["audioMessage", "audio"],
    ["videoMessage", "video"],
    ["documentMessage", "document"],
    ["stickerMessage", "sticker"],
  ];
  for (const [chave, tipo] of midias) {
    const m = obj(message[chave]);
    if (!m) continue;
    return {
      ...base,
      tipo,
      texto: str(m.caption),
      mime: str(m.mimetype) || null,
      nomeArquivo: str(m.fileName) || str(m.title) || null,
    };
  }

  const loc = obj(message.locationMessage) ?? obj(message.liveLocationMessage);
  if (loc) {
    const lat = Number(loc.degreesLatitude);
    const lng = Number(loc.degreesLongitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        ...base,
        tipo: "location",
        localizacao: {
          lat,
          lng,
          nome: str(loc.name) || null,
          endereco: str(loc.address) || null,
        },
      };
    }
  }

  const contato = obj(message.contactMessage);
  if (contato) {
    const vcard = str(contato.vcard);
    const tel = vcard.match(/TEL[^:]*:([+\d\s()-]+)/i)?.[1] ?? "";
    return {
      ...base,
      tipo: "contact",
      contato: { nome: str(contato.displayName), telefone: tel.replace(/\D/g, "") },
    };
  }

  // reação, apagar/editar (protocolMessage), enquete etc. — não entram na conversa
  return base;
}
