import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * PWA: sw.js, swe-worker* e manifest.webmanifest precisam ser públicos
     * (sem redirect de auth), senão o Chrome mostra "Não é possível instalar o app".
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|swe-worker[^/]*\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest)$).*)",
  ],
};
