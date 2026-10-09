import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { mensagemParaUsuario } from "@/lib/erros";

type ContextoErro = {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
};

type RequisicaoErro = {
  path?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
};

function header(req: RequisicaoErro, nome: string): string | null {
  const v = req.headers?.[nome];
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

/**
 * Grava em app_erros_log todo erro capturado pelo Next (render, Server Action,
 * rota). O `digest` é o código que aparece para o usuário: com ele a tela busca
 * a mensagem traduzida em /api/erros/{digest} e o suporte acha o erro real.
 */
export async function registrarErroServidor(
  err: unknown,
  request: RequisicaoErro,
  context: ContextoErro
) {
  try {
    const mensagem =
      err instanceof Error ? err.message : String(err ?? "erro desconhecido");
    const digest =
      typeof err === "object" && err !== null && "digest" in err
        ? String((err as { digest: unknown }).digest)
        : null;
    const stack = err instanceof Error ? (err.stack ?? null) : null;

    console.error(
      `[erro] ${context.routeType ?? "?"} ${request.path ?? ""} digest=${digest ?? "-"}:`,
      mensagem
    );

    const supabase = createServiceClient();
    await supabase.from("app_erros_log").insert({
      digest,
      origem: context.routeType ?? null,
      rota: context.routePath ?? request.path ?? null,
      metodo: request.method ?? null,
      action_id: header(request, "next-action"),
      mensagem: mensagem.slice(0, 4000),
      mensagem_usuario: mensagemParaUsuario(mensagem),
      stack: stack?.slice(0, 8000) ?? null,
    });
  } catch (e) {
    // Log de erro nunca pode derrubar a requisição.
    console.error("[erro] falha ao gravar app_erros_log:", e);
  }
}
