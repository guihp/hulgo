import "server-only";

import { normalizarTelefone } from "@/lib/ia-whatsapp/config";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Marca no chat (só para a equipe) que a IA acionou uma ferramenta e está
 * esperando a resposta — e depois o que voltou. Nunca lança: o registro não
 * pode atrapalhar o atendimento.
 */
export async function iniciarEventoFerramenta(
  telefone: string,
  ferramenta: string
): Promise<number | null> {
  try {
    const { data } = await createServiceClient()
      .from("app_ia_ferramenta_eventos")
      .insert({ telefone: normalizarTelefone(telefone), ferramenta })
      .select("id")
      .single();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

export async function concluirEventoFerramenta(
  id: number | null,
  resultado: unknown,
  erro?: string
): Promise<void> {
  if (id == null) return;
  try {
    const falhou = Boolean(erro) || (isObj(resultado) && resultado.ok === false);
    await createServiceClient()
      .from("app_ia_ferramenta_eventos")
      .update({
        status: falhou ? "erro" : "ok",
        resumo: resumir(resultado, erro),
        concluido_em: new Date().toISOString(),
      })
      .eq("id", id);
  } catch {
    // só registro
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** Uma linha curta do que a ferramenta devolveu. */
function resumir(resultado: unknown, erro?: string): string | null {
  if (erro) return erro.slice(0, 200);
  if (Array.isArray(resultado)) {
    return resultado.length ? `${resultado.length} resultado(s)` : "Nada encontrado";
  }
  if (!isObj(resultado)) return typeof resultado === "string" ? resultado.slice(0, 200) : null;

  const partes: string[] = [];
  const codigo = resultado.resultado;
  if (typeof codigo === "string") {
    partes.push(
      { OK: "Encontrado", NAO_ENCONTRADO: "Não encontrado", CNJ_LENTO: "Justiça não respondeu" }[codigo] ??
        codigo
    );
  }
  const processo = resultado.processo;
  if (isObj(processo) && Array.isArray(processo.ultimasMovimentacoes) && processo.ultimasMovimentacoes[0]) {
    partes.push(`última: ${String(processo.ultimasMovimentacoes[0])}`);
  }
  for (const k of ["texto", "mensagem", "erro", "resumo"]) {
    const v = resultado[k];
    if (typeof v === "string" && v.trim()) {
      partes.push(v.trim());
      break;
    }
  }
  const texto = partes.join(" · ");
  return texto ? texto.slice(0, 200) : null;
}
