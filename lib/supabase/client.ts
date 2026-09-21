import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import {
  isRememberMeEnabled,
  parseDocumentCookies,
  serializeCookie,
  withRememberCookieOptions,
} from "@/lib/supabase/remember";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return parseDocumentCookies();
        },
        setAll(cookiesToSet) {
          const remember = isRememberMeEnabled(parseDocumentCookies());

          for (const { name, value, options } of cookiesToSet) {
            document.cookie = serializeCookie(
              name,
              value,
              withRememberCookieOptions(options, remember) ?? { path: "/" }
            );
          }
        },
      },
    }
  );
}
