import "server-only";

import { revalidatePath } from "next/cache";
import { getAppUser } from "@/lib/actions/auth";
import type { AssistenteToolResult } from "@/lib/assistente/types";
import { getIaConfig } from "@/lib/ia-whatsapp/config";
import { PROMPT_PARCEIROS_PADRAO } from "@/lib/ia-whatsapp/parceiros";
import { createServiceClient } from "@/lib/supabase/service";

/*
 * Assistente × IA dos parceiros: ler as instruções e a configuração e propor
 * ajuste (card Confirmar). Não há rascunho: vale na próxima resposta da IA.
 */

export const IA_PARCEIROS_READ_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "ler_prompt_parceiros",
      description:
        "Lê as instruções (prompt) da IA que atende os PARCEIROS no WhatsApp e a configuração dela: modo (desligado | teste | ativo), se o andamento vai direto ou passa por aprovação e se processo novo é criado direto ou passa por aprovação. É uma IA separada da que atende clientes (essa é ler_prompt_agente). Só advogado.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

export const PROPOR_PROMPT_PARCEIROS_DEFINITION = {
  type: "function" as const,
  function: {
    name: "propor_alteracao_prompt_parceiros",
    description:
      "Propõe ajuste na IA dos PARCEIROS — card Confirmar; só advogado. Vale na próxima resposta (não tem rascunho). Antes: ler_prompt_parceiros e, se for reclamação de uma resposta, diagnosticar_atendimento_ia com o telefone do parceiro. Edição cirúrgica do texto: modo substituir | inserir_apos | inserir_antes (com âncora copiada exata) | acrescentar_fim | substituir_tudo (só se pedirem o texto inteiro) | restaurar_padrao. Também muda os interruptores consulta_direta e cadastro_direto, se pedirem.",
    parameters: {
      type: "object",
      properties: {
        modo: {
          type: "string",
          description:
            "substituir | inserir_apos | inserir_antes | acrescentar_fim | substituir_tudo | restaurar_padrao. Omitir se só mudar interruptores.",
        },
        ancora: { type: "string", description: "Trecho exato e único do texto atual (substituir/inserir_*)." },
        texto: { type: "string", description: "Texto novo (ou o que entra no lugar da âncora)." },
        consulta_direta: {
          type: "boolean",
          description: "true = andamento vai direto ao parceiro; false = passa por Aprovações.",
        },
        cadastro_direto: {
          type: "boolean",
          description: "true = processo novo é criado na hora; false = passa por Aprovações.",
        },
        motivo: { type: "string", description: "Por que este ajuste resolve (aparece no card)." },
      },
    },
  },
};

type ProposeOk = {
  ok: true;
  normalizedArgs: Record<string, unknown>;
  label: string;
  summary: string;
  details?: string[];
};
type ProposeErr = { ok: false; summary: string };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function resumo(v: string, max = 400): string {
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t || "(vazio)";
}

async function exigirAdvogado(): Promise<string | null> {
  const user = await getAppUser().catch(() => null);
  if (!user) return "Não autenticado.";
  if (user.papel !== "advogado") return "Só advogado pode ver e ajustar a IA dos parceiros.";
  return null;
}

const MODO_LABEL = {
  desligado: "desligada",
  teste: "modo teste (só parceiros que também são números de teste)",
  ativo: "ligada para todos os parceiros",
} as const;

export async function toolLerPromptParceiros(): Promise<AssistenteToolResult> {
  const negado = await exigirAdvogado();
  if (negado) return { ok: false, summary: negado };
  const c = await getIaConfig();
  const personalizado = Boolean(c.prompt_parceiros?.trim());
  return {
    ok: true,
    summary: `IA dos parceiros ${MODO_LABEL[c.parceiros_modo]}; andamento ${c.parceiros_consulta_direta ? "direto" : "com aprovação"}; processo novo ${c.parceiros_cadastro_direto ? "direto" : "com aprovação"}; instruções ${personalizado ? "personalizadas" : "padrão"}.`,
    links: [{ label: "IA do WhatsApp", href: "/ia-whatsapp" }],
    data: {
      modo: c.parceiros_modo,
      consulta_direta: c.parceiros_consulta_direta,
      cadastro_direto: c.parceiros_cadastro_direto,
      instrucoes_personalizadas: personalizado,
      instrucoes: c.prompt_parceiros?.trim() || PROMPT_PARCEIROS_PADRAO,
    },
  };
}

export async function proposeAlteracaoPromptParceiros(
  args: Record<string, unknown>
): Promise<ProposeOk | ProposeErr> {
  const negado = await exigirAdvogado();
  if (negado) return { ok: false, summary: negado };

  const c = await getIaConfig();
  const atual = c.prompt_parceiros?.trim() || PROMPT_PARCEIROS_PADRAO;
  const modo = str(args.modo);
  const ancora = typeof args.ancora === "string" ? args.ancora : "";
  const texto = typeof args.texto === "string" ? args.texto : "";
  let novo = atual;
  const details: string[] = [];

  if (modo) {
    if (["substituir", "inserir_apos", "inserir_antes"].includes(modo)) {
      if (!ancora.trim()) return { ok: false, summary: "Informe a âncora (trecho exato do texto atual)." };
      const ocorrencias = atual.split(ancora).length - 1;
      if (ocorrencias !== 1) {
        return {
          ok: false,
          summary:
            ocorrencias === 0
              ? "Âncora não encontrada. Chame ler_prompt_parceiros e copie o trecho exato."
              : "Âncora aparece mais de uma vez. Use um trecho maior e único.",
        };
      }
      novo =
        modo === "substituir"
          ? atual.replace(ancora, texto)
          : modo === "inserir_apos"
            ? atual.replace(ancora, `${ancora}\n${texto}`)
            : atual.replace(ancora, `${texto}\n${ancora}`);
      details.push(modo === "substituir" ? `Antes: ${resumo(ancora)}` : `Junto de: ${resumo(ancora, 160)}`);
      details.push(`${modo === "substituir" ? "Depois" : "Acrescenta"}: ${resumo(texto)}`);
    } else if (modo === "acrescentar_fim") {
      if (!texto.trim()) return { ok: false, summary: "Informe o texto a acrescentar." };
      novo = `${atual}\n${texto.trim()}`;
      details.push(`Acrescenta no fim: ${resumo(texto)}`);
    } else if (modo === "substituir_tudo") {
      if (!texto.trim()) return { ok: false, summary: "Informe o texto completo novo." };
      novo = texto.trim();
      details.push(`Texto inteiro novo: ${resumo(novo, 600)}`);
    } else if (modo === "restaurar_padrao") {
      novo = PROMPT_PARCEIROS_PADRAO;
      details.push("Volta às instruções padrão do sistema");
    } else {
      return { ok: false, summary: `Modo inválido: ${modo}` };
    }
  }

  const consulta = typeof args.consulta_direta === "boolean" ? args.consulta_direta : c.parceiros_consulta_direta;
  const cadastro = typeof args.cadastro_direto === "boolean" ? args.cadastro_direto : c.parceiros_cadastro_direto;
  if (consulta !== c.parceiros_consulta_direta) {
    details.push(`Andamento: ${consulta ? "vai direto ao parceiro" : "passa por Aprovações"}`);
  }
  if (cadastro !== c.parceiros_cadastro_direto) {
    details.push(`Processo novo: ${cadastro ? "criado na hora" : "passa por Aprovações"}`);
  }
  if (novo.trim() === atual.trim() && !details.length) {
    return { ok: false, summary: "Nada muda na IA dos parceiros com esses parâmetros." };
  }
  const motivo = str(args.motivo);
  if (motivo) details.push(`Motivo: ${motivo}`);

  return {
    ok: true,
    normalizedArgs: { prompt: novo, consulta_direta: consulta, cadastro_direto: cadastro },
    label: "Ajustar a IA dos parceiros",
    summary: `Ajustar a IA dos parceiros: ${details.join("; ")}`,
    details,
  };
}

export async function execAlteracaoPromptParceiros(
  args: Record<string, unknown>
): Promise<AssistenteToolResult> {
  const negado = await exigirAdvogado();
  if (negado) return { ok: false, summary: negado };
  const user = await getAppUser();
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("app_ia_whatsapp_config")
    .update({
      prompt_parceiros: prompt && prompt !== PROMPT_PARCEIROS_PADRAO.trim() ? prompt : null,
      parceiros_consulta_direta: args.consulta_direta === true,
      parceiros_cadastro_direto: args.cadastro_direto === true,
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    })
    .eq("id", 1);
  if (error) return { ok: false, summary: error.message };
  await supabase.from("app_log_eventos").insert({
    usuario_id: user?.id ?? null,
    entidade: "app_ia_whatsapp_config",
    entidade_id: 1,
    acao: "assistente_ajustou_parceiros",
    payload: { consulta_direta: args.consulta_direta === true, cadastro_direto: args.cadastro_direto === true },
  });
  revalidatePath("/ia-whatsapp");
  return {
    ok: true,
    summary: "IA dos parceiros atualizada. Já vale na próxima resposta para os parceiros.",
    links: [{ label: "IA do WhatsApp", href: "/ia-whatsapp" }],
  };
}
