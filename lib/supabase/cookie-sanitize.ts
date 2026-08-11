import { NextResponse } from "next/server";

const AUTH_COOKIE_PATTERN = /^sb-.+-auth-token(\.\d+)?$/;

/** Unlikely for a valid session; signals stale chunk pile-up. */
const AUTH_COOKIE_BYTES_CLEAR = 24_000;

/** Supabase chunks at ~3180 bytes; more than this suggests stale pile-up. */
const MAX_AUTH_COOKIE_CHUNKS = 7;

export function getSupabaseAuthStorageKey(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "sb-auth-token";
  const ref = new URL(url).hostname.split(".")[0] ?? "auth";
  return `sb-${ref}-auth-token`;
}

export function estimateCookieHeaderBytes(
  cookies: { name: string; value: string }[]
): number {
  if (cookies.length === 0) return 0;
  return (
    cookies.reduce((sum, c) => sum + c.name.length + c.value.length + 3, 0) - 2
  );
}

export function isSupabaseAuthCookieName(name: string): boolean {
  return AUTH_COOKIE_PATTERN.test(name);
}

export function getSupabaseAuthCookieNames(
  cookies: { name: string; value: string }[]
): string[] {
  return cookies
    .filter((c) => isSupabaseAuthCookieName(c.name))
    .map((c) => c.name);
}

export function shouldClearSupabaseAuthCookies(
  cookies: { name: string; value: string }[]
): boolean {
  const authCookies = cookies.filter((c) => isSupabaseAuthCookieName(c.name));
  if (authCookies.length === 0) return false;

  const storageKey = getSupabaseAuthStorageKey();
  const currentProjectCookies = authCookies.filter((c) =>
    c.name.startsWith(storageKey)
  );

  // Leftover cookies from another Supabase project or host migration.
  if (currentProjectCookies.length !== authCookies.length) return true;

  if (currentProjectCookies.length > MAX_AUTH_COOKIE_CHUNKS) return true;

  if (estimateCookieHeaderBytes(authCookies) >= AUTH_COOKIE_BYTES_CLEAR) {
    return true;
  }

  // Duplicate chunk indices (partial writes / refresh races).
  const seenIndices = new Set<string>();
  for (const cookie of currentProjectCookies) {
    const match = cookie.name.match(/\.(\d+)$/);
    const index = match ? match[1]! : "0";
    if (seenIndices.has(index)) return true;
    seenIndices.add(index);
  }

  return false;
}

export function applyClearSupabaseAuthCookies(
  response: NextResponse,
  cookieNames: string[]
): void {
  for (const name of cookieNames) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
}

export function stripSupabaseAuthCookiesFromRequest(
  request: { cookies: { delete: (name: string) => void } },
  cookieNames: string[]
): void {
  for (const name of cookieNames) {
    request.cookies.delete(name);
  }
}
