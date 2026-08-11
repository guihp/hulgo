import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  applyClearSupabaseAuthCookies,
  getSupabaseAuthCookieNames,
  shouldClearSupabaseAuthCookies,
  stripSupabaseAuthCookiesFromRequest,
} from "@/lib/supabase/cookie-sanitize";

export async function updateSession(request: NextRequest) {
  const incomingCookies = request.cookies.getAll();
  const authCookieNames = getSupabaseAuthCookieNames(incomingCookies);

  const isAuthRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/esqueci-senha") ||
    request.nextUrl.pathname.startsWith("/redefinir-senha");

  const isPublicApi =
    request.nextUrl.pathname.startsWith("/api/integracao") ||
    request.nextUrl.pathname.startsWith("/api/cron") ||
    request.nextUrl.pathname === "/api/health";

  if (
    authCookieNames.length > 0 &&
    shouldClearSupabaseAuthCookies(incomingCookies)
  ) {
    stripSupabaseAuthCookiesFromRequest(request, authCookieNames);

    if (isAuthRoute) {
      const response = NextResponse.next({ request });
      applyClearSupabaseAuthCookies(response, authCookieNames);
      return response;
    }

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const response = NextResponse.redirect(url);
    applyClearSupabaseAuthCookies(response, authCookieNames);
    return response;
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, cacheHeaders) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
          if (cacheHeaders) {
            for (const [key, value] of Object.entries(cacheHeaders)) {
              supabaseResponse.headers.set(key, value);
            }
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isAuthRoute && !isPublicApi) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
