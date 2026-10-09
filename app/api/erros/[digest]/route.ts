import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Mensagem traduzida de um erro de servidor pelo código (digest) que a tela
 * recebeu. Só devolve o texto para o usuário, nunca a mensagem técnica.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ digest: string }> }
) {
  const { digest } = await params;
  if (!/^[\w-]{1,64}$/.test(digest)) {
    return NextResponse.json({ mensagem: null }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ mensagem: null }, { status: 401 });

  const { data } = await supabase
    .from("app_erros_log")
    .select("mensagem_usuario")
    .eq("digest", digest)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json(
    { encontrado: Boolean(data), mensagem: data?.mensagem_usuario ?? null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
