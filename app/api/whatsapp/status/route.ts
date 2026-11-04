import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getInstanceStatus } from "@/lib/evogo/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Todo usuário logado consulta a cada minuto: guarda a resposta por 30 s para não martelar a EvoGo. */
const CACHE_MS = 30_000;
let cache: { em: number; conectado: boolean | null } | null = null;

/**
 * O número do escritório está conectado? Alimenta o alerta fixo de "reconectar o celular".
 * conectado = null quando não deu para perguntar (EvoGo fora do ar ou não configurada).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });

  if (!cache || Date.now() - cache.em > CACHE_MS) {
    let conectado: boolean | null;
    try {
      conectado = (await getInstanceStatus()).loggedIn;
    } catch {
      conectado = null;
    }
    cache = { em: Date.now(), conectado };
  }
  return NextResponse.json({ ok: true, conectado: cache.conectado });
}
