import { getAppConfigValue } from "@/lib/config/app-config";

const EVOGO_API_URL =
  process.env.EVOGO_API_URL?.replace(/\/$/, "") ??
  "https://evogo.iafeoficial.com";
const EVOGO_GLOBAL_API_KEY = process.env.EVOGO_GLOBAL_API_KEY?.trim() ?? "";
const EVOGO_INSTANCE_TOKEN = process.env.EVOGO_INSTANCE_TOKEN?.trim() ?? "";
const EVOGO_INSTANCE_ID = process.env.EVOGO_INSTANCE_ID?.trim() ?? "";
const EVOGO_INSTANCE_FALLBACK = process.env.EVOGO_INSTANCE_NAME?.trim() ?? "";
// Logout/disconnect apagam o webhook na EvoGo — reatado a cada connect.
const EVOGO_WEBHOOK_URL = process.env.EVOGO_WEBHOOK_URL?.trim() ?? "";
// Casing importa: a EvoGo só registra o evento como "MESSAGE" (maiúsculo).
const EVOGO_WEBHOOK_EVENTS = ["MESSAGE"];
const INSTANCE_CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;

type InstanceAuth = {
  instanceId: string;
  instanceToken: string;
};

type EvoGoInstance = {
  id?: string;
  name?: string;
  instanceName?: string;
  token?: string;
};

let cachedAuth: InstanceAuth | null =
  EVOGO_INSTANCE_ID && EVOGO_INSTANCE_TOKEN
    ? { instanceId: EVOGO_INSTANCE_ID, instanceToken: EVOGO_INSTANCE_TOKEN }
    : null;
let cachedAuthName = cachedAuth ? EVOGO_INSTANCE_FALLBACK : "";
let cacheExpiry = cachedAuth ? Number.MAX_SAFE_INTEGER : 0;

function requireGlobalApiKey(): string {
  if (!EVOGO_GLOBAL_API_KEY) {
    throw new Error(
      "EVOGO_GLOBAL_API_KEY não configurada — necessária para listar instâncias"
    );
  }
  return EVOGO_GLOBAL_API_KEY;
}

function instanceMatches(inst: EvoGoInstance, name: string): boolean {
  const target = name.toLowerCase();
  return (
    inst.name?.toLowerCase() === target ||
    inst.instanceName?.toLowerCase() === target
  );
}

function parseInstances(payload: unknown): EvoGoInstance[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as EvoGoInstance[];
    if (Array.isArray(obj.instances)) return obj.instances as EvoGoInstance[];
  }
  return [];
}

async function resolveWhatsAppInstanceName(): Promise<string> {
  const fromConfig = await getAppConfigValue("whatsapp_instancia");
  if (fromConfig.trim()) return fromConfig.trim();
  return EVOGO_INSTANCE_FALLBACK;
}

/** Resolve id + token da instância. Envio usa o token da instância, não o GLOBAL_API_KEY. */
export async function resolveInstanceAuth(
  name?: string
): Promise<InstanceAuth> {
  const instanceName = name?.trim() || (await resolveWhatsAppInstanceName());
  if (!instanceName) {
    throw new Error(
      "Instância WhatsApp não configurada — defina em Configurações"
    );
  }

  const now = Date.now();
  if (
    cachedAuth &&
    now < cacheExpiry &&
    cachedAuthName.toLowerCase() === instanceName.toLowerCase()
  ) {
    return cachedAuth;
  }

  const apikey = requireGlobalApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${EVOGO_API_URL}/instance/all`, {
      method: "GET",
      headers: {
        apikey,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const hint =
        res.status === 401
          ? " Verifique EVOGO_GLOBAL_API_KEY (GLOBAL_API_KEY do servidor EvoGo)."
          : "";
      throw new Error(
        `EvoGo instance/all falhou (${res.status}): ${body || res.statusText}.${hint}`
      );
    }

    const payload = await res.json();
    const instances = parseInstances(payload);
    const match = instances.find((inst) => instanceMatches(inst, instanceName));
    const instanceId = match?.id?.trim();
    const instanceToken = match?.token?.trim() || EVOGO_INSTANCE_TOKEN;

    if (!instanceId) {
      throw new Error(
        `Instância EvoGo "${instanceName}" não encontrada em /instance/all`
      );
    }
    if (!instanceToken) {
      throw new Error(
        `Token da instância "${instanceName}" não encontrado. Configure EVOGO_INSTANCE_TOKEN no .env.local`
      );
    }

    cachedAuth = { instanceId, instanceToken };
    cachedAuthName = instanceName;
    cacheExpiry = now + INSTANCE_CACHE_TTL_MS;
    return cachedAuth;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getInstanceId(name?: string): Promise<string> {
  const auth = await resolveInstanceAuth(name);
  return auth.instanceId;
}

export function extractMessageId(data: unknown): string {
  if (!data || typeof data !== "object") {
    throw new Error("Resposta EvoGo inválida: payload vazio");
  }

  const root = data as Record<string, unknown>;

  if (typeof root.messageId === "string" && root.messageId.trim()) {
    return root.messageId.trim();
  }

  const nested = root.data;
  if (nested && typeof nested === "object") {
    const nestedObj = nested as Record<string, unknown>;
    if (typeof nestedObj.messageId === "string" && nestedObj.messageId.trim()) {
      return nestedObj.messageId.trim();
    }
    const info = nestedObj.Info ?? nestedObj.info;
    if (info && typeof info === "object") {
      const id =
        (info as Record<string, unknown>).ID ??
        (info as Record<string, unknown>).id;
      if (typeof id === "string" && id.trim()) return id.trim();
    }
  }

  const info = root.Info ?? root.info;
  if (info && typeof info === "object") {
    const id =
      (info as Record<string, unknown>).ID ??
      (info as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }

  throw new Error("Resposta EvoGo sem messageId identificável");
}

export type EvoGoInstanceStatus = {
  connected: boolean;
  loggedIn: boolean;
  name: string;
};

export type EvoGoQrCode = {
  base64: string;
  code: string | null;
};

function readBool(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unwrapEvoGoData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const root = payload as Record<string, unknown>;
  const data = root.data;
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return root;
}

function parseInstanceStatus(payload: unknown): EvoGoInstanceStatus {
  const data = unwrapEvoGoData(payload);
  return {
    connected: readBool(data.Connected ?? data.connected),
    loggedIn: readBool(data.LoggedIn ?? data.loggedIn),
    name: readString(data.Name ?? data.name),
  };
}

function parseQrCode(payload: unknown): EvoGoQrCode | null {
  const data = unwrapEvoGoData(payload);
  const base64 = readString(
    data.Qrcode ?? data.qrcode ?? data.base64 ?? data.QRCode
  );
  if (!base64) return null;
  const code = readString(data.Code ?? data.code) || null;
  return { base64, code };
}

function extractErrorMessage(parsed: unknown, fallback: string): string {
  if (!parsed || typeof parsed !== "object") return fallback;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.error === "string" && obj.error.trim()) return obj.error.trim();
  if (typeof obj.message === "string" && obj.message.trim()) {
    return obj.message.trim();
  }
  if (obj.error && typeof obj.error === "object") {
    const nested = obj.error as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim()) {
      return nested.message.trim();
    }
  }
  return fallback;
}

function isQrNotReadyError(message: string): boolean {
  return /no qr code available/i.test(message);
}

function isClientDisconnectedError(message: string): boolean {
  return /client disconnected/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evogoRequest<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const { instanceId, instanceToken } = await resolveInstanceAuth();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${EVOGO_API_URL}${path}`, {
      method,
      headers: {
        apikey: instanceToken,
        instanceId,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }

    if (!res.ok) {
      const message = extractErrorMessage(parsed, text || res.statusText);
      if (path === "/instance/qr" && isQrNotReadyError(message)) {
        return { qrNotReady: true } as T;
      }
      // Sem sessão ativa (após logout/restart da EvoGo) o status responde
      // 400 "client disconnected" — é um estado normal, não um erro
      if (path === "/instance/status" && isClientDisconnectedError(message)) {
        return { clientDisconnected: true } as T;
      }
      const hint =
        res.status === 401
          ? " O envio exige o token da instância (resolvido via /instance/all ou EVOGO_INSTANCE_TOKEN)."
          : "";
      throw new Error(`EvoGo ${path} falhou (${res.status}): ${message}${hint}`);
    }

    return parsed as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function evogoFetch<T = unknown>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  return evogoRequest<T>("POST", path, body);
}

export async function getInstanceStatus(): Promise<EvoGoInstanceStatus> {
  const data = await evogoRequest("GET", "/instance/status");
  if (
    data &&
    typeof data === "object" &&
    "clientDisconnected" in data &&
    (data as { clientDisconnected?: boolean }).clientDisconnected
  ) {
    return { connected: false, loggedIn: false, name: "" };
  }
  return parseInstanceStatus(data);
}

export async function getInstanceQrCode(): Promise<EvoGoQrCode | null> {
  const data = await evogoRequest<unknown>("GET", "/instance/qr");
  if (
    data &&
    typeof data === "object" &&
    "qrNotReady" in data &&
    (data as { qrNotReady?: boolean }).qrNotReady
  ) {
    return null;
  }
  return parseQrCode(data);
}

/** Conecta a instância e espera o QR ficar disponível (EvoGo demora alguns segundos). */
export async function ensureInstanceQrCode(options?: {
  attempts?: number;
  delayMs?: number;
}): Promise<{ status: EvoGoInstanceStatus; qrCode: EvoGoQrCode | null }> {
  const attempts = options?.attempts ?? 8;
  const delayMs = options?.delayMs ?? 1500;

  let { jid } = await connectInstance({ immediate: true });
  let jaResetou = false;

  let status = await getInstanceStatus();
  if (status.loggedIn) {
    return { status, qrCode: null };
  }

  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(delayMs);
    status = await getInstanceStatus();
    if (status.loggedIn) {
      return { status, qrCode: null };
    }
    const qrCode = await getInstanceQrCode();
    if (qrCode) {
      return { status, qrCode };
    }

    // Sessão morta: há credencial gravada (jid) mas o cliente cai na hora
    // (connected=false) e o QR nunca nasce — acontece quando o número foi
    // desconectado pelo celular ("logged out from another device"). O
    // connect fica retomando a sessão revogada para sempre; a saída é
    // recriar a instância (mesmo nome/token) e reconectar do zero.
    if (!jaResetou && jid && !status.connected && !status.loggedIn && i >= 2) {
      jaResetou = true;
      await resetInstance();
      ({ jid } = await connectInstance({ immediate: true }));
    }
  }

  status = await getInstanceStatus();
  return { status, qrCode: null };
}

export async function connectInstance(options?: {
  immediate?: boolean;
  phone?: string;
}): Promise<{ jid: string }> {
  const body: Record<string, unknown> = {};
  if (options?.immediate) body.immediate = true;
  if (options?.phone?.trim()) body.phone = options.phone.trim();
  if (EVOGO_WEBHOOK_URL) {
    body.webhookUrl = EVOGO_WEBHOOK_URL;
    body.subscribe = EVOGO_WEBHOOK_EVENTS;
  }
  const data = await evogoRequest("POST", "/instance/connect", body);

  // Grupos precisam continuar chegando no webhook (ignoreGroups=false).
  try {
    await ensureGroupsNotIgnored();
  } catch {
    // Não bloqueia a conexão se a leitura/ajuste de settings falhar.
  }

  // jid preenchido = a EvoGo tem credencial de sessão gravada
  return { jid: readString(unwrapEvoGoData(data).jid) };
}

/**
 * Recria a instância na EvoGo com o mesmo nome e token. Necessário quando a
 * sessão gravada foi revogada pelo WhatsApp ("logged out from another
 * device"): o connect fica tentando retomá-la para sempre e nunca gera QR.
 */
async function resetInstance(): Promise<void> {
  if (EVOGO_INSTANCE_ID) {
    throw new Error(
      "Sessão da instância inválida e EVOGO_INSTANCE_ID está fixo no .env — " +
        "recrie a instância na EvoGo e atualize EVOGO_INSTANCE_ID/EVOGO_INSTANCE_TOKEN"
    );
  }

  const apikey = requireGlobalApiKey();
  const name = await resolveWhatsAppInstanceName();
  const { instanceId, instanceToken } = await resolveInstanceAuth();

  const del = await fetch(`${EVOGO_API_URL}/instance/delete/${instanceId}`, {
    method: "DELETE",
    headers: { apikey },
    cache: "no-store",
  });
  if (!del.ok) {
    throw new Error(`EvoGo instance/delete falhou (${del.status})`);
  }

  const create = await fetch(`${EVOGO_API_URL}/instance/create`, {
    method: "POST",
    headers: { apikey, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      token: instanceToken,
      advancedSettings: {
        alwaysOnline: true,
        ignoreGroups: false,
        ignoreStatus: false,
        readMessages: false,
        rejectCall: false,
        msgRejectCall: "",
      },
    }),
    cache: "no-store",
  });
  if (!create.ok) {
    throw new Error(`EvoGo instance/create falhou (${create.status})`);
  }

  // id mudou — força novo lookup em /instance/all
  cachedAuth = null;
  cachedAuthName = "";
  cacheExpiry = 0;
}

async function ensureGroupsNotIgnored(): Promise<void> {
  const { instanceId } = await resolveInstanceAuth();
  const settings = await evogoRequest<Record<string, unknown>>(
    "GET",
    `/instance/${instanceId}/advanced-settings`
  );
  if (!readBool(settings.ignoreGroups)) return;

  await evogoRequest("PUT", `/instance/${instanceId}/advanced-settings`, {
    ...settings,
    ignoreGroups: false,
  });
}

/**
 * Fecha só o websocket — o pareamento continua e a EvoGo religa sozinha
 * (alwaysOnline / próximo connect). NÃO desvincula o número.
 */
export async function disconnectInstance(): Promise<void> {
  await evogoRequest("POST", "/instance/disconnect");
}

/**
 * Desvincula o número da instância (DELETE /instance/logout). É isso que o
 * botão "Desconectar número" precisa chamar — depois só reconecta lendo QR.
 */
export async function logoutInstance(): Promise<void> {
  try {
    await evogoRequest("DELETE", "/instance/logout");
  } catch (err) {
    // Sessão já derrubada — não há o que desvincular
    if (err instanceof Error && isClientDisconnectedError(err.message)) return;
    throw err;
  }
}

export async function sendText(number: string, text: string): Promise<string> {
  const data = await evogoFetch("/send/text", { number, text });
  return extractMessageId(data);
}

export type EvoGoMediaType = "image" | "audio" | "video" | "document";

export async function sendMedia(params: {
  number: string;
  url: string;
  type: EvoGoMediaType;
  caption?: string;
  filename?: string;
}): Promise<string> {
  const body: Record<string, unknown> = {
    number: params.number,
    url: params.url,
    type: params.type,
  };
  if (params.caption?.trim()) body.caption = params.caption.trim();
  if (params.filename?.trim()) body.filename = params.filename.trim();

  const data = await evogoFetch("/send/media", body);
  return extractMessageId(data);
}

export async function sendLocation(params: {
  number: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}): Promise<string> {
  const body: Record<string, unknown> = {
    number: params.number,
    latitude: params.latitude,
    longitude: params.longitude,
  };
  if (params.name?.trim()) body.name = params.name.trim();
  if (params.address?.trim()) body.address = params.address.trim();

  const data = await evogoFetch("/send/location", body);
  return extractMessageId(data);
}

export async function sendSticker(
  number: string,
  sticker: string
): Promise<string> {
  const data = await evogoFetch("/send/sticker", { number, sticker });
  return extractMessageId(data);
}

export async function sendContact(params: {
  number: string;
  vcard: {
    fullName: string;
    phone: string;
    organization?: string;
  };
}): Promise<string> {
  const vcard: Record<string, string> = {
    fullName: params.vcard.fullName.trim(),
    phone: params.vcard.phone.replace(/\D/g, ""),
  };
  if (params.vcard.organization?.trim()) {
    vcard.organization = params.vcard.organization.trim();
  }

  const data = await evogoFetch("/send/contact", {
    number: params.number,
    vcard,
  });
  return extractMessageId(data);
}
