const HUMAN_PREFIX = /^\[MENSAGEM DE TEXTO ENVIADA\]:\s*\(([\s\S]+)\)$/;

export function cleanMessageText(text: string | null | undefined): string {
  if (!text) return "";
  const match = text.match(HUMAN_PREFIX);
  return match ? match[1].trim() : text.trim();
}

export function parseDocumentList(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Cliente (bolha esquerda): lead (n8n) ou human (legado) */
export function isClientMessage(type: string | null | undefined): boolean {
  return type === "lead" || type === "human";
}

/** Agente IA (bolha direita): ai ou bot */
export function isAgentMessage(type: string | null | undefined): boolean {
  return type === "ai" || type === "bot";
}

export function contactInitials(phone: string | null | undefined, name?: string | null): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.slice(-2) || "??";
}

export type LocationPayload = {
  name?: string | null;
  address?: string | null;
  lat: number;
  lng: number;
};

export type ContactPayload = {
  fullName: string;
  phone: string;
  organization?: string | null;
};

export function parseLocationPayload(
  text: string | null | undefined
): LocationPayload | null {
  if (!text?.trim()) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const lat = parsed.lat ?? parsed.latitude;
    const lng = parsed.lng ?? parsed.longitude;
    if (typeof lat === "number" && typeof lng === "number") {
      return {
        name: typeof parsed.name === "string" ? parsed.name : null,
        address: typeof parsed.address === "string" ? parsed.address : null,
        lat,
        lng,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function parseContactPayload(
  text: string | null | undefined
): ContactPayload | null {
  if (!text?.trim()) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const fullName =
      typeof parsed.fullName === "string"
        ? parsed.fullName
        : typeof parsed.name === "string"
          ? parsed.name
          : null;
    const phone =
      typeof parsed.phone === "string"
        ? parsed.phone
        : typeof parsed.telefone === "string"
          ? parsed.telefone
          : null;
    if (fullName && phone) {
      return {
        fullName,
        phone,
        organization:
          typeof parsed.organization === "string" ? parsed.organization : null,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export type MediaDisplayKind =
  | "image"
  | "audio"
  | "video"
  | "document"
  | "unknown";

/** Infere tipo visual de mídia (inclui mensage_type genérico "media" do n8n). */
export function resolveMediaDisplayKind(
  mensageType: string | null | undefined,
  url: string | null | undefined
): MediaDisplayKind {
  const type = (mensageType ?? "").toLowerCase();
  if (type === "image" || type === "sticker") return "image";
  if (type === "audio") return "audio";
  if (type === "video") return "video";
  if (type === "document") return "document";

  if (!url) return "unknown";

  if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url)) return "image";
  if (/\.(mp3|ogg|wav|m4a|opus|aac)(\?|$)/i.test(url)) return "audio";
  if (/\.(mp4|mov|webm)(\?|$)/i.test(url)) return "video";
  if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx)(\?|$)/i.test(url)) return "document";

  if (type === "media") return "image";
  return "unknown";
}
