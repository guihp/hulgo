/** Preferência de "Manter conectado" — lida no browser e no middleware. */
export const REMEMBER_COOKIE = "app-remember-me";

const PREFERENCE_MAX_AGE = 400 * 24 * 60 * 60;

export function isRememberMeEnabled(
  cookies: { name: string; value: string }[]
): boolean {
  const value = cookies.find((c) => c.name === REMEMBER_COOKIE)?.value;
  // Sem cookie: comportamento histórico (sessão persistente).
  if (value === undefined) return true;
  return value !== "0";
}

type CookieOpts = {
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: true | false | "lax" | "strict" | "none";
  name?: string;
};

/**
 * Com "Manter conectado" desligado, remove maxAge/expires → cookie de sessão
 * (some ao fechar o navegador). Mantém maxAge: 0 para limpeza.
 */
export function withRememberCookieOptions<T extends CookieOpts | undefined>(
  options: T,
  remember: boolean
): T {
  if (!options || remember) return options;
  if (options.maxAge === 0) return options;
  const { maxAge: _maxAge, expires: _expires, ...rest } = options;
  return rest as T;
}

function encodeCookieValue(value: string) {
  return encodeURIComponent(value);
}

export function parseDocumentCookies(): { name: string; value: string }[] {
  if (typeof document === "undefined" || !document.cookie) return [];
  return document.cookie.split("; ").flatMap((part) => {
    const eq = part.indexOf("=");
    if (eq < 0) return [];
    const name = part.slice(0, eq);
    const raw = part.slice(eq + 1);
    try {
      return [{ name, value: decodeURIComponent(raw) }];
    } catch {
      return [{ name, value: raw }];
    }
  });
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOpts = {}
) {
  const parts = [`${name}=${encodeCookieValue(value)}`];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.secure) parts.push("Secure");
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite === true) parts.push("SameSite=Strict");
  else if (options.sameSite) {
    parts.push(
      `SameSite=${options.sameSite.charAt(0).toUpperCase()}${options.sameSite.slice(1)}`
    );
  }
  return parts.join("; ");
}

export function writeRememberPreference(remember: boolean) {
  if (typeof document === "undefined") return;

  const secure = window.location.protocol === "https:";
  document.cookie = serializeCookie(REMEMBER_COOKIE, remember ? "1" : "0", {
    path: "/",
    sameSite: "lax",
    secure,
    ...(remember ? { maxAge: PREFERENCE_MAX_AGE } : {}),
  });
}
