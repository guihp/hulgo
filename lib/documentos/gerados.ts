import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import { getAppConfig } from "@/lib/config/app-config";
import { preencherPdf, nomeArquivo } from "@/lib/documentos/preencher-pdf";
import {
  aplicarTemplate,
  entradaDoCampo,
  filtrarEntradaCampo,
  getDocumentoTemplate,
  valoresIniciais,
  type DadosDocumento,
  type DocumentoTemplate,
} from "@/lib/utils/documentos";
import { formatCpf, normalizeCpf } from "@/lib/utils/cpf";
import { fichaPessoaHref } from "@/lib/utils/ficha";
import { formatPhone } from "@/lib/utils/phone";

/** Validade do link de download (a linha é apagada pelo pg_cron depois). */
export const VALIDADE_DOCUMENTO_HORAS = 24;

const ESCRITORIO_PADRAO = "Boueres e Fonteles Advogados";

/**
 * Dados do cliente para pré-preencher um modelo: caso (funil de vendas) por id,
 * ou pessoa pelo CPF (processo ou caso). Sem nada = formulário em branco.
 */
export async function carregarDadosDocumento(params: {
  casoId?: number | null;
  cpf?: string | null;
}): Promise<DadosDocumento | null> {
  const supabase = await createClient();
  const config = await getAppConfig();
  const escritorioNome = config.escritorio_nome || ESCRITORIO_PADRAO;
  const base: DadosDocumento = {
    clienteNome: "",
    clienteCpf: "",
    clienteNascimento: null,
    clienteTelefone: "",
    beneficio: "benefício previdenciário",
    escritorioNome,
    voltarHref: "/documentos",
  };

  if (params.casoId) {
    const { data: caso } = await supabase
      .from("casos_novos")
      .select("id, nome, cpf, data_nascimento, telefone, beneficio_identificado")
      .eq("id", params.casoId)
      .maybeSingle();
    if (!caso) return null;
    return {
      ...base,
      clienteNome: caso.nome ?? "",
      clienteCpf: caso.cpf ?? "",
      clienteNascimento: caso.data_nascimento,
      clienteTelefone: formatPhone(caso.telefone ?? ""),
      beneficio: caso.beneficio_identificado ?? base.beneficio,
      voltarHref: fichaPessoaHref({
        cpf: caso.cpf,
        contactNorm: caso.telefone,
        aba: "caso",
        casoId: caso.id,
      }),
    };
  }

  const cpf = normalizeCpf(params.cpf ?? "");
  if (cpf) {
    const [{ data: processo }, { data: caso }] = await Promise.all([
      supabase
        .from("processos_clientes")
        .select("nome, cpf, data_nascimento, telefone, beneficio_identificado, descricao_caso")
        .eq("cpf", cpf)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("casos_novos")
        .select("nome, cpf, data_nascimento, telefone, beneficio_identificado")
        .eq("cpf", cpf)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (!processo && !caso) return null;
    return {
      ...base,
      clienteNome: processo?.nome || caso?.nome || "",
      clienteCpf: cpf,
      clienteNascimento: processo?.data_nascimento ?? caso?.data_nascimento ?? null,
      clienteTelefone: formatPhone(processo?.telefone || caso?.telefone || ""),
      beneficio:
        processo?.beneficio_identificado ??
        caso?.beneficio_identificado ??
        processo?.descricao_caso ??
        base.beneficio,
      voltarHref: `/clientes/${cpf}`,
    };
  }

  return base;
}

/** Converte o que a IA mandou (às vezes o rótulo) no value da opção. */
function valorDaOpcao(
  opcoes: { value: string; label: string }[],
  bruto: string
): string | null {
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const alvo = norm(bruto);
  const achou =
    opcoes.find((o) => norm(o.value) === alvo) ??
    opcoes.find((o) => norm(o.label) === alvo) ??
    opcoes.find((o) => o.value && norm(o.label).includes(alvo));
  return achou ? achou.value : null;
}

export type MontagemDocumento = {
  valores: Record<string, string>;
  /** Rótulos dos campos que ficaram vazios. */
  faltando: string[];
  /** Chaves enviadas que não existem / opção inválida. */
  ignorados: string[];
};

/**
 * Valores finais = ficha do cliente (fontes do template) + valores informados
 * (ex.: lidos do RG/comprovante pela IA). Campos derivados (ex.: qualificação
 * da procuração) são recalculados, salvo se vierem explicitamente.
 */
export function montarValoresDocumento(
  template: DocumentoTemplate,
  dados: DadosDocumento,
  informados: Record<string, unknown>
): MontagemDocumento {
  const valores = valoresIniciais(template, dados);
  const ignorados: string[] = [];
  const explicitos = new Set<string>();

  for (const [key, raw] of Object.entries(informados ?? {})) {
    const campo = template.campos.find((c) => c.key === key);
    const bruto = raw == null ? "" : String(raw).trim();
    if (!campo) {
      ignorados.push(key);
      continue;
    }
    if (!bruto) continue;
    if (campo.tipo === "opcao") {
      const v = valorDaOpcao(campo.opcoes ?? [], bruto);
      if (v === null) {
        ignorados.push(`${key}=${bruto}`);
        continue;
      }
      valores[key] = v;
    } else {
      let v = filtrarEntradaCampo(bruto, entradaDoCampo(campo));
      if (/cpf/i.test(key) && normalizeCpf(v).length === 11) v = formatCpf(v);
      valores[key] = v;
    }
    explicitos.add(key);
  }

  for (const campo of template.campos) {
    if (campo.template && !explicitos.has(campo.key)) {
      valores[campo.key] = aplicarTemplate(campo.template, valores);
    }
  }

  const faltando = template.campos
    .filter((c) => {
      const v = (valores[c.key] ?? "").trim();
      return !v || (c.template && v.includes("__________"));
    })
    .map((c) => c.label);

  return { valores, faltando, ignorados };
}

export async function criarDocumentoGerado(input: {
  modelo: string;
  valores: Record<string, string>;
  clienteNome?: string | null;
  clienteCpf?: string | null;
}): Promise<{ id: string; expiresAt: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_documentos_gerados")
    .insert({
      modelo: input.modelo,
      valores: input.valores,
      cliente_nome: input.clienteNome || null,
      cliente_cpf: input.clienteCpf ? normalizeCpf(input.clienteCpf) : null,
    })
    .select("id, expires_at")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, expiresAt: data.expires_at };
}

export type DocumentoGerado = {
  id: string;
  modelo: string;
  template: DocumentoTemplate;
  valores: Record<string, string>;
  clienteNome: string | null;
  clienteCpf: string | null;
  expiresAt: string;
};

/** null = não existe ou expirou (RLS só devolve os válidos). */
export async function carregarDocumentoGerado(id: string): Promise<DocumentoGerado | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_documentos_gerados")
    .select("id, modelo, valores, cliente_nome, cliente_cpf, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (!data || new Date(data.expires_at).getTime() <= Date.now()) return null;
  const template = getDocumentoTemplate(data.modelo);
  if (!template) return null;
  const valores: Record<string, string> = {};
  if (data.valores && typeof data.valores === "object" && !Array.isArray(data.valores)) {
    for (const [k, v] of Object.entries(data.valores)) {
      if (typeof v === "string") valores[k] = v;
    }
  }
  return {
    id: data.id,
    modelo: data.modelo,
    template,
    valores,
    clienteNome: data.cliente_nome,
    clienteCpf: data.cliente_cpf,
    expiresAt: data.expires_at,
  };
}

/** Lê o modelo de public/ e desenha os valores. */
export async function renderizarDocumento(
  template: DocumentoTemplate,
  valores: Record<string, string>
): Promise<{ bytes: Uint8Array; nome: string }> {
  const arquivo = path.join(process.cwd(), "public", template.file.replace(/^\//, ""));
  const modelo = await readFile(arquivo);
  const bytes = await preencherPdf(template, valores, modelo);
  return { bytes, nome: nomeArquivo(template, valores.nome || valores.beneficiario1Nome || "") };
}

export function documentoGeradoHref(id: string, opts?: { download?: boolean }): string {
  return `/api/documentos/gerados/${id}${opts?.download ? "?download=1" : ""}`;
}

export function documentoGeradoEditorHref(slug: string, id: string): string {
  return `/documentos/${slug}?gerado=${id}`;
}
