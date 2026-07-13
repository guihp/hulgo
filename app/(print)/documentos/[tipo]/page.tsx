import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppConfig } from "@/lib/config/app-config";
import { DocumentoEditor } from "@/components/documentos/documento-editor";
import { isTipoDocumento } from "@/lib/utils/documentos";
import { normalizeCpf } from "@/lib/utils/cpf";
import { formatPhone } from "@/lib/utils/phone";

export default async function DocumentoPage({
  params,
  searchParams,
}: {
  params: Promise<{ tipo: string }>;
  searchParams: Promise<{ caso?: string; cpf?: string }>;
}) {
  const { tipo } = await params;
  const { caso: casoId, cpf: cpfParam } = await searchParams;
  if (!isTipoDocumento(tipo)) notFound();

  const supabase = await createClient();
  const config = await getAppConfig();

  let clienteNome = "";
  let clienteCpf = "";
  let clienteNascimento: string | null = null;
  let clienteTelefone = "";
  let beneficio = "benefício previdenciário";
  let voltarHref = "/kanban";

  if (casoId) {
    const { data: caso } = await supabase
      .from("casos_novos")
      .select("id, nome, cpf, data_nascimento, telefone, beneficio_identificado")
      .eq("id", Number(casoId))
      .single();
    if (!caso) notFound();
    clienteNome = caso.nome ?? "";
    clienteCpf = caso.cpf ?? "";
    clienteNascimento = caso.data_nascimento;
    clienteTelefone = caso.telefone ?? "";
    beneficio = caso.beneficio_identificado ?? beneficio;
    voltarHref = `/kanban/${caso.id}`;
  } else if (cpfParam) {
    const cpf = normalizeCpf(cpfParam);
    const { data: processo } = await supabase
      .from("processos_clientes")
      .select("nome, cpf, data_nascimento, telefone, descricao_caso")
      .eq("cpf", cpf)
      .limit(1)
      .single();
    if (!processo) notFound();
    clienteNome = processo.nome;
    clienteCpf = processo.cpf;
    clienteNascimento = processo.data_nascimento;
    clienteTelefone = processo.telefone ?? "";
    beneficio = processo.descricao_caso ?? beneficio;
    voltarHref = `/clientes/${cpf}`;
  } else {
    notFound();
  }

  return (
    <DocumentoEditor
      tipo={tipo}
      dados={{
        clienteNome: clienteNome || "________",
        clienteCpf,
        clienteNascimento,
        clienteTelefone: formatPhone(clienteTelefone),
        beneficio,
        escritorioNome:
          config.escritorio_nome || "Boueres e Fonteles Advogados",
        voltarHref,
      }}
    />
  );
}
