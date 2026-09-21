import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import {
  isRememberMeEnabled,
  withRememberCookieOptions,
} from "@/lib/supabase/remember";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            const remember = isRememberMeEnabled(cookieStore.getAll());
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(
                name,
                value,
                withRememberCookieOptions(options, remember)
              )
            );
          } catch {
            // Server Component — ignore
          }
        },
      },
    }
  );
}
