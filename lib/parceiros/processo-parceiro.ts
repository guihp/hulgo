import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { normalizeCpf } from "@/lib/utils/cpf";
import { brazilianDateToIso } from "@/lib/utils/dates";
import { normalizeAreaProcesso } from "@/lib/utils/processos";
import type { Json } from "@/types/database";

/** Dados de um processo novo mandado por parceiro (aprovacoes_pendentes.dados). */
export type DadosProcessoParceiro = {
  parceiro_nome: string;
  nome: string;
  cpf: string;
  data_nascimento?: string | null;
  beneficio?: string | null;
  area?: string | null;
  telefone_cliente?: string | null;
  descricao?: string | null;
  documentos?: { nome_documento: string; url_media: string }[];
};

/** Lê `dados` da aprovação no formato esperado (ou null se não for processo novo). */
export function lerDadosProcessoParceiro(dados: Json | null | undefined): DadosProcessoParceiro | null {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return null;
  const d = dados as Record<string, unknown>;
  if (typeof d.nome !== "string" || typeof d.cpf !== "string") return null;
  const docs = Array.isArray(d.documentos) ? d.documentos : [];
  return {
    parceiro_nome: String(d.parceiro_nome ?? ""),
    nome: d.nome,
    cpf: d.cpf,
    data_nascimento: typeof d.data_nascimento === "string" ? d.data_nascimento : null,
    beneficio: typeof d.beneficio === "string" ? d.beneficio : null,
    area: typeof d.area === "string" ? d.area : null,
    telefone_cliente: typeof d.telefone_cliente === "string" ? d.telefone_cliente : null,
    descricao: typeof d.descricao === "string" ? d.descricao : null,
    documentos: docs
      .filter(
        (x): x is { nome_documento: string; url_media: string } =>
          Boolean(x) &&
          typeof (x as { url_media?: unknown }).url_media === "string" &&
          typeof (x as { nome_documento?: unknown }).nome_documento === "string"
      )
      .map((x) => ({ nome_documento: x.nome_documento, url_media: x.url_media })),
  };
}

/**
 * Cria o processo (sem número) ligado ao parceiro, na 1ª coluna do funil da área,
 * e guarda os documentos que o parceiro mandou na pasta do processo, na ficha do CPF.
 */
export async function criarProcessoDoParceiro(
  dados: DadosProcessoParceiro,
  parceiroId: string
): Promise<{ processoId: number; documentos: number }> {
  const supabase = createServiceClient();
  const cpf = normalizeCpf(dados.cpf);
  if (cpf.length !== 11) throw new Error("CPF do cliente precisa ter 11 dígitos");
  if (!dados.nome.trim()) throw new Error("Nome do cliente é obrigatório");

  const area = normalizeAreaProcesso(dados.area);
  const { data: colunas } = await supabase
    .from("app_processo_colunas")
    .select("chave")
    .eq("funil", area)
    .eq("ativo", true)
    .order("ordem", { ascending: true })
    .limit(1);

  const nascimento = dados.data_nascimento?.trim();
  const telefone = (dados.telefone_cliente ?? "").replace(/\D/g, "");

  const { data: novo, error } = await supabase
    .from("processos_clientes")
    .insert({
      nome: dados.nome.trim(),
      cpf,
      data_nascimento: nascimento
        ? nascimento.includes("/")
          ? brazilianDateToIso(nascimento)
          : nascimento
        : null,
      telefone: telefone || null,
      numero_processo: null,
      area,
      funil_coluna: colunas?.[0]?.chave ?? null,
      beneficio_identificado: dados.beneficio?.trim() || null,
      descricao_caso: dados.descricao?.trim() || null,
      parceiro_id: parceiroId,
      ativo: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const docs = (dados.documentos ?? []).filter((d) => d.url_media.trim());
  if (docs.length) {
    const { data: msgs } = await supabase
      .from("mensagens")
      .select("id, mensagem_id, conteudo_media")
      .in(
        "conteudo_media",
        docs.map((d) => d.url_media)
      );
    const porUrl = new Map((msgs ?? []).map((m) => [m.conteudo_media, m]));
    const { error: docErro } = await supabase.from("documentos_cliente").insert(
      docs.map((d) => ({
        nome_documento: d.nome_documento.trim() || "Documento",
        descricao: `Enviado pelo parceiro ${dados.parceiro_nome}`.trim(),
        url_media: d.url_media,
        origem: "whatsapp",
        cpf,
        processo_id: novo.id,
        pasta: `processo:${novo.id}`,
        mensagem_id: porUrl.get(d.url_media)?.mensagem_id ?? null,
        mensagem_row_id: porUrl.get(d.url_media)?.id ?? null,
      }))
    );
    if (docErro) console.error("[parceiro] documentos do processo", docErro.message);
  }

  await supabase.from("app_log_eventos").insert({
    entidade: "processos_clientes",
    entidade_id: novo.id,
    acao: "criado_por_parceiro",
    payload: { parceiro_id: parceiroId, parceiro: dados.parceiro_nome, documentos: docs.length },
  });

  return { processoId: novo.id, documentos: docs.length };
}

/**
 * Efeito de aprovar uma pendência de parceiro do tipo "novo_processo": cria o processo
 * (uma vez só) e grava o id na pendência. Consulta de andamento não tem efeito extra.
 */
export async function aplicarAprovacaoDeParceiro(aprovacao: {
  id: number;
  tipo: string;
  parceiro_id: string | null;
  dados: Json | null;
  processo_id: number | null;
}): Promise<number | null> {
  if (aprovacao.tipo !== "novo_processo") return null;
  if (aprovacao.processo_id) return aprovacao.processo_id;
  const dados = lerDadosProcessoParceiro(aprovacao.dados);
  if (!dados || !aprovacao.parceiro_id) {
    throw new Error("Pendência sem os dados do processo — cadastre o processo manualmente");
  }
  const { processoId } = await criarProcessoDoParceiro(dados, aprovacao.parceiro_id);
  await createServiceClient()
    .from("aprovacoes_pendentes")
    .update({ processo_id: processoId })
    .eq("id", aprovacao.id);
  return processoId;
}
