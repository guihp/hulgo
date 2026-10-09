"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";
import { enviarMensagem } from "@/lib/actions/mensagens";
import { controlarIA } from "@/lib/n8n";
import { normalizeCpf } from "@/lib/utils/cpf";
import { phoneToContactNorm } from "@/lib/utils/phone";
import type { AprovacaoAcao, AprovacaoStatus, Json } from "@/types/database";

export type AprovacaoContexto = {
  contactNorm: string;
  cpf: string;
  processos: {
    id: number;
    numero_processo: string | null;
    tribunal: string | null;
    area: string | null;
    ativo: boolean | null;
  }[];
  casoFunil: {
    id: number;
    status: string | null;
    beneficio_identificado: string | null;
    nome: string | null;
  } | null;
  anteriores: {
    id: number;
    status: string | null;
    created_at: string | null;
    numero_processo: string | null;
    decidido_em: string | null;
  }[];
  mensagens: {
    id: number;
    type: string | null;
    text: string | null;
    created_at: string;
  }[];
  decisorNome: string | null;
};

export async function getAprovacaoContexto(
  aprovacaoId: number
): Promise<AprovacaoContexto | null> {
  const user = await getAppUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: aprovacao } = await supabase
    .from("aprovacoes_pendentes")
    .select("id, cpf, telefone_cliente, decidido_por")
    .eq("id", aprovacaoId)
    .single();

  if (!aprovacao) return null;

  const cpf = normalizeCpf(aprovacao.cpf ?? "");
  const contactNorm = phoneToContactNorm(aprovacao.telefone_cliente);

  const [processos, casoFunil, anteriores, mensagens, decisor] =
    await Promise.all([
      cpf
        ? supabase
            .from("processos_clientes")
            .select("id, numero_processo, tribunal, area, ativo")
            .eq("cpf", cpf)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
      contactNorm
        ? supabase
            .from("casos_novos")
            .select("id, status, beneficio_identificado, nome")
            .ilike("telefone", `%${contactNorm.slice(-8)}%`)
            .order("created_at", { ascending: false })
            .limit(1)
            .then((r) => r.data?.[0] ?? null)
        : Promise.resolve(null),
      cpf
        ? supabase
            .from("aprovacoes_pendentes")
            .select("id, status, created_at, numero_processo, decidido_em")
            .eq("cpf", aprovacao.cpf ?? "")
            .neq("id", aprovacao.id)
            .order("created_at", { ascending: false })
            .limit(5)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
      contactNorm
        ? supabase
            .from("mensagens")
            .select("id, type, text, created_at")
            .eq("contact_norm", contactNorm)
            .order("created_at", { ascending: false })
            .limit(6)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
      aprovacao.decidido_por
        ? supabase
            .from("app_usuarios")
            .select("nome")
            .eq("id", aprovacao.decidido_por)
            .single()
            .then((r) => r.data?.nome ?? null)
        : Promise.resolve(null),
    ]);

  return {
    contactNorm,
    cpf,
    processos,
    casoFunil,
    anteriores,
    mensagens: [...mensagens].reverse(),
    decisorNome: decisor,
  };
}

const STATUS_POR_ACAO: Record<AprovacaoAcao, AprovacaoStatus> = {
  aprovar: "aprovado",
  responder: "respondido_manual",
  recusar: "recusado",
};

export type DecisaoInput = {
  id: number;
  acao: AprovacaoAcao;
  /** Texto enviado ao cliente. Obrigatório em aprovar/responder; opcional em recusar. */
  texto?: string;
  /** Motivo interno da recusa (não vai pro cliente). */
  motivoRecusa?: string;
};

export type DecisaoResult = {
  success: true;
  status: AprovacaoStatus;
  mensagemEnviada: boolean;
  messageId: string | null;
  webhook: { configured: boolean; ok: boolean; error?: string };
  warning?: string;
};

async function logEvent(
  entidadeId: number,
  acao: string,
  payload: Json,
  usuarioId: string
) {
  const supabase = await createClient();
  await supabase.from("app_log_eventos").insert({
    usuario_id: usuarioId,
    entidade: "aprovacoes_pendentes",
    entidade_id: entidadeId,
    acao,
    payload,
  });
}

export async function decidirAprovacao(
  input: DecisaoInput
): Promise<DecisaoResult> {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (user.papel !== "advogado") {
    throw new Error("Apenas advogados podem decidir pendências");
  }

  const texto = input.texto?.trim() ?? "";
  if ((input.acao === "aprovar" || input.acao === "responder") && !texto) {
    throw new Error("Texto da mensagem ao cliente é obrigatório");
  }

  const supabase = await createClient();
  const { data: aprovacao, error: fetchError } = await supabase
    .from("aprovacoes_pendentes")
    .select("*")
    .eq("id", input.id)
    .single();

  if (fetchError || !aprovacao) throw new Error("Pendência não encontrada");
  if (aprovacao.status !== "pendente") {
    throw new Error("Esta pendência já foi decidida");
  }

  // 1) Envia a mensagem ao cliente pelo próprio sistema (EvoGo)
  let messageId: string | null = null;
  let warning: string | undefined;
  const deveEnviar = texto.length > 0;

  if (deveEnviar) {
    const contactNorm = aprovacao.telefone_cliente
      .replace(/@.*$/, "")
      .replace(/\D/g, "");
    const envio = await enviarMensagem({
      kind: "text",
      phone: aprovacao.telefone_cliente,
      contactNorm,
      instancia: aprovacao.instancia ?? undefined,
      text: texto,
      pausarIA: false, // o estado da IA é resolvido abaixo (despause)
    });
    messageId = envio.messageId;
    warning = envio.warning;
  }

  // 2) Grava a decisão
  const status = STATUS_POR_ACAO[input.acao];
  const { error: updateError } = await supabase
    .from("aprovacoes_pendentes")
    .update({
      status,
      resumo_final: input.acao === "aprovar" ? texto : null,
      resposta_manual: input.acao === "responder" ? texto : null,
      motivo_recusa: input.acao === "recusar" ? (input.motivoRecusa?.trim() || null) : null,
      decidido_por: user.id,
      decidido_em: new Date().toISOString(),
      enviado_whatsapp: deveEnviar && messageId !== null,
      mensagem_id: messageId,
    })
    .eq("id", input.id);

  if (updateError) {
    throw new Error(
      deveEnviar
        ? `Mensagem enviada ao cliente, mas falhou ao gravar a decisão: ${updateError.message}`
        : updateError.message
    );
  }

  // 3) Despausa a IA no n8n (a mensagem já foi enviada pelo sistema)
  const webhook = await controlarIA(
    "despausar",
    aprovacao.telefone_cliente,
    aprovacao.instancia,
    { id_aprovacao: input.id, acao_aprovacao: input.acao, mensagem_ja_enviada: true }
  );

  await logEvent(
    input.id,
    "decisao",
    {
      acao: input.acao,
      status,
      mensagem_enviada: deveEnviar,
      message_id: messageId,
      motivo_recusa: input.motivoRecusa ?? null,
      webhook_configured: webhook.configured,
      webhook_ok: webhook.ok,
      ...(webhook.error ? { webhook_error: webhook.error } : {}),
    },
    user.id
  );

  revalidatePath("/aprovacoes");
  revalidatePath(`/aprovacoes/${input.id}`);
  revalidatePath("/");

  return {
    success: true,
    status,
    mensagemEnviada: deveEnviar && messageId !== null,
    messageId,
    webhook,
    warning,
  };
}
