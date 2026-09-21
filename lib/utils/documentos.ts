import { formatCpf, normalizeCpf } from "./cpf";
import { normalizePhone } from "./phone";

/**
 * Catálogo de modelos PDF preenchidos por overlay de texto.
 *
 * As coordenadas de `placements` são em pontos PDF, origem no canto inferior
 * esquerdo da página (padrão pdf-lib). Foram extraídas das posições reais dos
 * campos em branco de cada template — ver docs/DOCUMENTOS-PDF.md para o
 * procedimento de recalibração.
 */

export type FonteCampo =
  | "clienteNome"
  | "clienteCpf"
  | "clienteCpfDigitos"
  | "clienteNascimento"
  | "clienteNascimentoDia"
  | "clienteNascimentoMes"
  | "clienteNascimentoAno"
  | "clienteTelefone"
  | "clienteTelefoneDdd"
  | "clienteTelefoneNumero"
  | "beneficio"
  | "escritorio"
  | "hoje"
  | "hojeDia"
  | "hojeMes"
  | "hojeMesExtenso"
  | "hojeAno";

/** Restrição de digitação no formulário do editor. */
export type EntradaCampo = "texto" | "numero" | "misto";

export type CampoDocumento = {
  key: string;
  label: string;
  /** Preenche o valor inicial a partir dos dados do caso. */
  source?: FonteCampo;
  default?: string;
  placeholder?: string;
  tipo?: "texto" | "textarea" | "opcao";
  opcoes?: { value: string; label: string }[];
  /**
   * Texto montado a partir de outros campos (`{key}`). Recalculado enquanto o
   * usuário não editar o campo manualmente.
   */
  template?: string;
  colSpan?: 1 | 2 | 3;
  /** Só letras / só dígitos / livre. Se omitido, inferido pela chave. */
  entrada?: EntradaCampo;
};

const KEYS_NUMERO = new Set([
  "cpf",
  "testemunha1Cpf",
  "testemunha2Cpf",
  "representanteCpf",
  "beneficiario1Cpf",
  "beneficiario2Cpf",
  "dataDia",
  "dataAno",
  "nascimentoDia",
  "nascimentoMes",
  "nascimentoAno",
  "rgDia",
  "rgMes",
  "rgAno",
  "cep",
  "telefoneDdd",
  "telefoneNumero",
  "rgp",
  "matriculaCei",
]);

const KEYS_TEXTO = new Set([
  "nome",
  "nacionalidade",
  "estadoCivil",
  "profissao",
  "testemunha1Nome",
  "testemunha2Nome",
  "municipio",
  "bairro",
  "advogado",
  "apelido",
  "localNascimento",
  "rgLocal",
  "representanteNome",
  "beneficiario1Nome",
  "beneficiario2Nome",
  "local",
  "condicao1",
  "condicao2",
  "data",
  "localAtividade1",
  "localAtividade2",
]);

export function entradaDoCampo(campo: CampoDocumento): EntradaCampo {
  if (campo.entrada) return campo.entrada;
  if (campo.tipo === "opcao") return "misto";
  if (campo.key === "dataMes") {
    return campo.source === "hojeMesExtenso" ? "texto" : "numero";
  }
  if (KEYS_NUMERO.has(campo.key)) return "numero";
  if (KEYS_TEXTO.has(campo.key)) return "texto";
  return "misto";
}

/** Filtra o que o usuário digita conforme a restrição do campo. */
export function filtrarEntradaCampo(
  valor: string,
  entrada: EntradaCampo
): string {
  if (entrada === "numero") {
    // Dígitos + máscara usual de CPF/telefone/datas.
    return valor.replace(/[^\d.\-\/\s()]/g, "");
  }
  if (entrada === "texto") {
    return valor.replace(/\d/g, "");
  }
  return valor;
}

export type LinhaPlacement = { x: number; y: number; maxWidth: number };

export type Placement = {
  key: string;
  /** 1-based. */
  page: number;
  x: number;
  y: number;
  size?: number;
  maxWidth?: number;
  /** Só desenha quando o valor do campo for exatamente isto (checkboxes). */
  when?: string;
  /** Texto literal a desenhar no lugar do valor do campo (ex.: "X"). */
  text?: string;
  /** Quebra o valor em várias linhas do formulário. */
  lines?: LinhaPlacement[];
};

export type DocumentoTemplate = {
  slug: string;
  label: string;
  descricao: string;
  file: string;
  campos: CampoDocumento[];
  placements: Placement[];
};

const ADVOGADO_PADRAO = "Hulgo Fernando Sousa Boueres";

const QUALIFICACAO_PROCURACAO =
  "{nome}, {nacionalidade}, {estadoCivil}, {profissao}, portador(a) do RG nº {rg} " +
  "e inscrito(a) no CPF sob o nº {cpf}, residente e domiciliado(a) em {endereco}.";

/** Campos de identificação repetidos nas autodeclarações (INSS). */
function camposSeguradoInss(): CampoDocumento[] {
  return [
    { key: "nome", label: "Nome", source: "clienteNome", colSpan: 2 },
    { key: "apelido", label: "Apelido" },
    { key: "nascimentoDia", label: "Nasc. dia", source: "clienteNascimentoDia" },
    { key: "nascimentoMes", label: "Nasc. mês", source: "clienteNascimentoMes" },
    { key: "nascimentoAno", label: "Nasc. ano", source: "clienteNascimentoAno" },
    { key: "localNascimento", label: "Local de nascimento", colSpan: 2 },
    { key: "endereco", label: "Endereço residencial", colSpan: 3 },
    { key: "municipio", label: "Município" },
    { key: "uf", label: "UF", default: "MA" },
    { key: "cpf", label: "CPF", source: "clienteCpf" },
    { key: "rg", label: "RG" },
    { key: "rgLocal", label: "Local de expedição do RG" },
    { key: "rgDia", label: "Expedição — dia" },
    { key: "rgMes", label: "Expedição — mês" },
    { key: "rgAno", label: "Expedição — ano" },
  ];
}

const SITUACAO_OPCOES = [
  { value: "individual", label: "Individualmente" },
  { value: "familiar", label: "Regime de economia familiar" },
];

export const DOCUMENTOS_TEMPLATES: DocumentoTemplate[] = [
  {
    slug: "procuracao-previdenciaria",
    label: "Procuração previdenciária",
    descricao: 'Procuração "ad judicia" do escritório.',
    file: "/documentos-templates/procuracao-previdenciaria.pdf",
    campos: [
      { key: "nome", label: "Nome do outorgante", source: "clienteNome", colSpan: 2 },
      { key: "cpf", label: "CPF", source: "clienteCpf" },
      { key: "nacionalidade", label: "Nacionalidade", default: "brasileiro(a)" },
      { key: "estadoCivil", label: "Estado civil", placeholder: "casado(a)" },
      { key: "profissao", label: "Profissão", placeholder: "lavrador(a)" },
      { key: "rg", label: "RG" },
      { key: "endereco", label: "Endereço completo", colSpan: 2 },
      {
        key: "qualificacao",
        label: "Qualificação do outorgante (texto impresso)",
        tipo: "textarea",
        template: QUALIFICACAO_PROCURACAO,
        colSpan: 3,
      },
      { key: "dataDia", label: "Dia", source: "hojeDia" },
      { key: "dataMes", label: "Mês", source: "hojeMesExtenso" },
      { key: "dataAno", label: "Ano", source: "hojeAno" },
      { key: "testemunha1Nome", label: "Testemunha 1 — nome", colSpan: 2 },
      { key: "testemunha1Cpf", label: "Testemunha 1 — CPF" },
      { key: "testemunha2Nome", label: "Testemunha 2 — nome", colSpan: 2 },
      { key: "testemunha2Cpf", label: "Testemunha 2 — CPF" },
    ],
    placements: [
      {
        key: "qualificacao",
        page: 1,
        x: 170,
        y: 733,
        size: 10,
        lines: [
          { x: 170, y: 733, maxWidth: 337 },
          { x: 87, y: 714, maxWidth: 420 },
          { x: 87, y: 695, maxWidth: 420 },
          { x: 87, y: 676, maxWidth: 420 },
          { x: 87, y: 657, maxWidth: 420 },
          { x: 87, y: 638, maxWidth: 420 },
          { x: 87, y: 619, maxWidth: 420 },
        ],
      },
      { key: "dataDia", page: 1, x: 280, y: 240, size: 10, maxWidth: 16 },
      { key: "dataMes", page: 1, x: 310, y: 240, size: 10, maxWidth: 74 },
      { key: "dataAno", page: 1, x: 399, y: 240, size: 8, maxWidth: 22 },
      { key: "testemunha1Nome", page: 1, x: 113, y: 141, size: 9, maxWidth: 232 },
      { key: "testemunha1Cpf", page: 1, x: 369, y: 141, size: 9, maxWidth: 138 },
      { key: "testemunha2Nome", page: 1, x: 113, y: 95, size: 9, maxWidth: 237 },
      { key: "testemunha2Cpf", page: 1, x: 374, y: 95, size: 9, maxWidth: 133 },
    ],
  },

  {
    slug: "termo-representacao",
    label: "Termo de representação (Anexo VI)",
    descricao: "Autorização de acesso a informações previdenciárias.",
    file: "/documentos-templates/termo-representacao.pdf",
    campos: [
      { key: "nome", label: "Nome", source: "clienteNome", colSpan: 2 },
      { key: "cpf", label: "CPF", source: "clienteCpf" },
      { key: "rg", label: "RG" },
      { key: "endereco", label: "Endereço (com CEP)", colSpan: 2 },
      { key: "municipio", label: "Município" },
      { key: "advogado", label: "Advogado(a)", default: ADVOGADO_PADRAO, colSpan: 2 },
      // O formulário já imprime "OAB" antes da linha.
      { key: "oab", label: "OAB (sem a sigla)", default: "MA nº 7.675" },
      {
        key: "servico",
        label: "Serviço / benefício requerido",
        tipo: "opcao",
        colSpan: 2,
        opcoes: [
          { value: "", label: "— não marcar —" },
          { value: "idade-rural", label: "I. Aposentadoria por idade — rural" },
          { value: "idade-urbana", label: "I. Aposentadoria por idade — urbana" },
          { value: "tempo-contribuicao", label: "II. Aposentadoria por tempo de contribuição" },
          { value: "pensao-morte", label: "III. Pensão por morte previdenciária" },
          { value: "auxilio-reclusao-rural", label: "IV. Auxílio-reclusão — rural" },
          { value: "auxilio-reclusao-urbano", label: "IV. Auxílio-reclusão — urbano" },
          { value: "salario-maternidade-rural", label: "V. Salário-maternidade — rural" },
          { value: "salario-maternidade-urbano", label: "V. Salário-maternidade — urbano" },
          { value: "copia-processos", label: "VI. Cópia de processos" },
          { value: "extratos", label: "VII. Extratos previdenciários" },
          { value: "revisao", label: "VIII. Revisão de benefício" },
          { value: "recurso-jrps", label: "IX. Recurso à JRPS" },
        ],
      },
      { key: "data", label: "Data (por extenso)", source: "hoje", colSpan: 2 },
    ],
    placements: [
      { key: "nome", page: 1, x: 76, y: 662.9, size: 9, maxWidth: 206 },
      { key: "cpf", page: 1, x: 361, y: 662.9, size: 9, maxWidth: 70 },
      { key: "rg", page: 1, x: 463, y: 662.9, size: 9, maxWidth: 54 },
      { key: "endereco", page: 1, x: 105, y: 652.3, size: 9, maxWidth: 301 },
      { key: "municipio", page: 1, x: 474.5, y: 652.3, size: 9, maxWidth: 65 },
      { key: "advogado", page: 1, x: 171, y: 641.6, size: 9, maxWidth: 143 },
      { key: "oab", page: 1, x: 340, y: 641.6, size: 9, maxWidth: 58 },

      // Checkboxes "( )" — X entre os parênteses já impressos.
      { key: "servico", when: "idade-rural", text: "X", page: 1, x: 58.5, y: 600.1, size: 8 },
      { key: "servico", when: "idade-rural", text: "X", page: 1, x: 209.5, y: 600.1, size: 8 },
      { key: "servico", when: "idade-urbana", text: "X", page: 1, x: 58.5, y: 600.1, size: 8 },
      { key: "servico", when: "idade-urbana", text: "X", page: 1, x: 265, y: 600.1, size: 8 },
      { key: "servico", when: "tempo-contribuicao", text: "X", page: 1, x: 65, y: 590.8, size: 8 },
      { key: "servico", when: "pensao-morte", text: "X", page: 1, x: 69.5, y: 581.7, size: 8 },
      { key: "servico", when: "auxilio-reclusao-rural", text: "X", page: 1, x: 65, y: 572.5, size: 8 },
      { key: "servico", when: "auxilio-reclusao-rural", text: "X", page: 1, x: 177.5, y: 572.5, size: 8 },
      { key: "servico", when: "auxilio-reclusao-urbano", text: "X", page: 1, x: 65, y: 572.5, size: 8 },
      { key: "servico", when: "auxilio-reclusao-urbano", text: "X", page: 1, x: 231.5, y: 572.5, size: 8 },
      { key: "servico", when: "salario-maternidade-rural", text: "X", page: 1, x: 58.5, y: 563.4, size: 8 },
      { key: "servico", when: "salario-maternidade-rural", text: "X", page: 1, x: 188.5, y: 563.4, size: 8 },
      { key: "servico", when: "salario-maternidade-urbano", text: "X", page: 1, x: 58.5, y: 563.4, size: 8 },
      { key: "servico", when: "salario-maternidade-urbano", text: "X", page: 1, x: 242.5, y: 563.4, size: 8 },
      { key: "servico", when: "copia-processos", text: "X", page: 1, x: 64, y: 554.2, size: 8 },
      { key: "servico", when: "extratos", text: "X", page: 1, x: 69.5, y: 545.4, size: 8 },
      { key: "servico", when: "revisao", text: "X", page: 1, x: 69.5, y: 536.1, size: 8 },
      { key: "servico", when: "recurso-jrps", text: "X", page: 1, x: 64.5, y: 526.3, size: 8 },

      { key: "data", page: 1, x: 93, y: 468.3, size: 9, maxWidth: 200 },
      { key: "data", page: 1, x: 106, y: 244.3, size: 9, maxWidth: 200 },
    ],
  },

  {
    slug: "termo-responsabilidade-in128",
    label: "Termo de responsabilidade (IN 128)",
    descricao: "Anexo XXVII da IN PRES/INSS nº 128/2022.",
    file: "/documentos-templates/termo-responsabilidade-in128.pdf",
    campos: [
      {
        key: "representanteNome",
        label: "Representante (quem assina)",
        default: ADVOGADO_PADRAO,
        colSpan: 2,
      },
      { key: "representanteCpf", label: "CPF do representante" },
      { key: "beneficiario1Nome", label: "Beneficiário 1 — nome", source: "clienteNome", colSpan: 2 },
      { key: "beneficiario1Cpf", label: "Beneficiário 1 — CPF", source: "clienteCpf" },
      { key: "beneficiario2Nome", label: "Beneficiário 2 — nome", colSpan: 2 },
      { key: "beneficiario2Cpf", label: "Beneficiário 2 — CPF" },
      {
        key: "qualidade",
        label: "Qualidade da representação",
        tipo: "opcao",
        default: "procurador",
        opcoes: [
          { value: "tutor-nato", label: "Tutor nato" },
          { value: "tutor-legal", label: "Tutor legal" },
          { value: "curador", label: "Curador" },
          { value: "responsavel-guarda", label: "Responsável — termo de guarda" },
          { value: "administrador-provisorio", label: "Administrador provisório" },
          { value: "procurador", label: "Procurador" },
        ],
      },
      { key: "local", label: "Local", placeholder: "São Luís/MA", colSpan: 2 },
      { key: "dataDia", label: "Dia", source: "hojeDia" },
      { key: "dataMes", label: "Mês", source: "hojeMes" },
      { key: "dataAno", label: "Ano", source: "hojeAno" },
    ],
    placements: [
      { key: "representanteNome", page: 1, x: 70.5, y: 679, size: 10, maxWidth: 318 },
      { key: "representanteCpf", page: 1, x: 169, y: 662.3, size: 10, maxWidth: 140 },
      { key: "beneficiario1Nome", page: 1, x: 85, y: 324.8, size: 10, maxWidth: 279 },
      { key: "beneficiario1Cpf", page: 1, x: 400, y: 324.8, size: 10, maxWidth: 136 },
      { key: "beneficiario2Nome", page: 1, x: 85, y: 308, size: 10, maxWidth: 279 },
      { key: "beneficiario2Cpf", page: 1, x: 400, y: 308, size: 10, maxWidth: 136 },

      { key: "qualidade", when: "tutor-nato", text: "X", page: 1, x: 55.5, y: 202.2, size: 9 },
      { key: "qualidade", when: "tutor-legal", text: "X", page: 1, x: 271, y: 202.2, size: 9 },
      { key: "qualidade", when: "curador", text: "X", page: 1, x: 55.5, y: 185.4, size: 9 },
      { key: "qualidade", when: "responsavel-guarda", text: "X", page: 1, x: 271, y: 185.4, size: 9 },
      { key: "qualidade", when: "administrador-provisorio", text: "X", page: 1, x: 55.5, y: 168.6, size: 9 },
      { key: "qualidade", when: "procurador", text: "X", page: 1, x: 270.5, y: 168.6, size: 9 },

      { key: "local", page: 1, x: 82.8, y: 119.5, size: 10, maxWidth: 246 },
      { key: "dataDia", page: 1, x: 371, y: 119.5, size: 10, maxWidth: 26 },
      { key: "dataMes", page: 1, x: 406, y: 119.5, size: 10, maxWidth: 25 },
      { key: "dataAno", page: 1, x: 441, y: 119.5, size: 10, maxWidth: 58 },
    ],
  },

  {
    slug: "autodeclaracao-rural",
    label: "Autodeclaração segurado especial (rural)",
    descricao: "Anexo VIII da IN PRES/INSS nº 128/2022.",
    file: "/documentos-templates/autodeclaracao-rural.pdf",
    campos: [
      ...camposSeguradoInss(),
      { key: "periodo1", label: "Período 1 (dd/mm/aaaa a dd/mm/aaaa)", colSpan: 2 },
      { key: "condicao1", label: "Condição em relação ao imóvel 1", placeholder: "Posseiro" },
      { key: "situacao1", label: "Situação 1", tipo: "opcao", opcoes: SITUACAO_OPCOES },
      { key: "periodo2", label: "Período 2", colSpan: 2 },
      { key: "condicao2", label: "Condição em relação ao imóvel 2" },
      { key: "situacao2", label: "Situação 2", tipo: "opcao", opcoes: SITUACAO_OPCOES },
      { key: "local", label: "Local (assinatura)", placeholder: "São Luís/MA", colSpan: 2 },
      { key: "dataDia", label: "Dia", source: "hojeDia" },
      { key: "dataMes", label: "Mês", source: "hojeMes" },
      { key: "dataAno", label: "Ano", source: "hojeAno" },
    ],
    placements: [
      { key: "nome", page: 1, x: 108.9, y: 506.9, size: 10, maxWidth: 263 },
      { key: "apelido", page: 1, x: 424.6, y: 506.9, size: 10, maxWidth: 97 },
      { key: "nascimentoDia", page: 1, x: 193, y: 485, size: 9, maxWidth: 17 },
      { key: "nascimentoMes", page: 1, x: 213.5, y: 485, size: 9, maxWidth: 17 },
      { key: "nascimentoAno", page: 1, x: 234, y: 485, size: 9, maxWidth: 28 },
      { key: "localNascimento", page: 1, x: 398, y: 485, size: 9, maxWidth: 121 },
      { key: "endereco", page: 1, x: 210, y: 463, size: 9, maxWidth: 308 },
      { key: "municipio", page: 1, x: 133, y: 441, size: 9, maxWidth: 151 },
      { key: "uf", page: 1, x: 307, y: 441, size: 9, maxWidth: 44 },
      { key: "cpf", page: 1, x: 389, y: 441, size: 9, maxWidth: 131 },
      { key: "rg", page: 1, x: 95, y: 419.1, size: 9, maxWidth: 90 },
      { key: "rgLocal", page: 1, x: 344.5, y: 419.1, size: 9, maxWidth: 90 },
      { key: "rgDia", page: 1, x: 444, y: 419.1, size: 8, maxWidth: 17 },
      { key: "rgMes", page: 1, x: 464.5, y: 419.1, size: 8, maxWidth: 17 },
      { key: "rgAno", page: 1, x: 485, y: 419.1, size: 8, maxWidth: 33 },

      { key: "periodo1", page: 1, x: 93, y: 301.8, size: 8, maxWidth: 95 },
      { key: "condicao1", page: 1, x: 198, y: 301.8, size: 8, maxWidth: 155 },
      { key: "situacao1", when: "individual", text: "X", page: 1, x: 365.5, y: 316.4, size: 8 },
      { key: "situacao1", when: "familiar", text: "X", page: 1, x: 365.5, y: 301.8, size: 8 },
      { key: "periodo2", page: 1, x: 93, y: 257.4, size: 8, maxWidth: 95 },
      { key: "condicao2", page: 1, x: 198, y: 257.4, size: 8, maxWidth: 155 },
      { key: "situacao2", when: "individual", text: "X", page: 1, x: 365.5, y: 272, size: 8 },
      { key: "situacao2", when: "familiar", text: "X", page: 1, x: 365.5, y: 257.4, size: 8 },

      { key: "local", page: 6, x: 103, y: 657.2, size: 9, maxWidth: 305 },
      { key: "dataDia", page: 6, x: 443.5, y: 657.2, size: 9, maxWidth: 17 },
      { key: "dataMes", page: 6, x: 464.7, y: 657.2, size: 9, maxWidth: 17 },
      { key: "dataAno", page: 6, x: 486, y: 657.2, size: 9, maxWidth: 33 },
    ],
  },

  {
    slug: "autodeclaracao-pescador",
    label: "Autodeclaração segurado especial (pescador)",
    descricao: "Anexo IX da IN PRES/INSS nº 128/2022.",
    file: "/documentos-templates/autodeclaracao-pescador.pdf",
    campos: [
      ...camposSeguradoInss(),
      { key: "rgp", label: "RGP" },
      { key: "matriculaCei", label: "Matrícula CEI/CAEPF", colSpan: 2 },
      { key: "periodo1", label: "Período 1 (dd/mm/aaaa a dd/mm/aaaa)", colSpan: 2 },
      { key: "localAtividade1", label: "Local da atividade 1", placeholder: "Mar / Rio / Lagoa" },
      { key: "situacao1", label: "Situação 1", tipo: "opcao", opcoes: SITUACAO_OPCOES },
      { key: "periodo2", label: "Período 2", colSpan: 2 },
      { key: "localAtividade2", label: "Local da atividade 2" },
      { key: "situacao2", label: "Situação 2", tipo: "opcao", opcoes: SITUACAO_OPCOES },
      { key: "local", label: "Local (assinatura)", placeholder: "São Luís/MA", colSpan: 2 },
      { key: "data", label: "Data (por extenso)", source: "hoje" },
    ],
    placements: [
      { key: "nome", page: 1, x: 108.9, y: 542.5, size: 10, maxWidth: 263 },
      { key: "apelido", page: 1, x: 424.4, y: 542.5, size: 10, maxWidth: 97 },
      { key: "nascimentoDia", page: 1, x: 193, y: 520.6, size: 9, maxWidth: 17 },
      { key: "nascimentoMes", page: 1, x: 213.5, y: 520.6, size: 9, maxWidth: 17 },
      { key: "nascimentoAno", page: 1, x: 234.5, y: 520.6, size: 8, maxWidth: 22 },
      { key: "localNascimento", page: 1, x: 392, y: 520.6, size: 9, maxWidth: 127 },
      { key: "endereco", page: 1, x: 207.8, y: 498.6, size: 9, maxWidth: 308 },
      { key: "municipio", page: 1, x: 133, y: 476.7, size: 9, maxWidth: 151 },
      { key: "uf", page: 1, x: 307, y: 476.7, size: 9, maxWidth: 44 },
      { key: "cpf", page: 1, x: 389, y: 476.7, size: 9, maxWidth: 131 },
      { key: "rg", page: 1, x: 95, y: 454.7, size: 9, maxWidth: 90 },
      { key: "rgLocal", page: 1, x: 344.5, y: 454.7, size: 9, maxWidth: 90 },
      { key: "rgDia", page: 1, x: 444, y: 454.7, size: 8, maxWidth: 17 },
      { key: "rgMes", page: 1, x: 464.5, y: 454.7, size: 8, maxWidth: 17 },
      { key: "rgAno", page: 1, x: 485, y: 454.7, size: 8, maxWidth: 33 },
      { key: "rgp", page: 1, x: 106, y: 432.6, size: 9, maxWidth: 120 },
      { key: "matriculaCei", page: 1, x: 355.5, y: 432.6, size: 9, maxWidth: 161 },

      { key: "periodo1", page: 1, x: 82, y: 330.1, size: 8, maxWidth: 115 },
      { key: "localAtividade1", page: 1, x: 232, y: 330.1, size: 8, maxWidth: 135 },
      { key: "situacao1", when: "individual", text: "X", page: 1, x: 385.3, y: 344.7, size: 8 },
      { key: "situacao1", when: "familiar", text: "X", page: 1, x: 385.3, y: 330.1, size: 8 },
      { key: "periodo2", page: 1, x: 82, y: 285.6, size: 8, maxWidth: 115 },
      { key: "localAtividade2", page: 1, x: 232, y: 285.6, size: 8, maxWidth: 135 },
      { key: "situacao2", when: "individual", text: "X", page: 1, x: 385.3, y: 300.3, size: 8 },
      { key: "situacao2", when: "familiar", text: "X", page: 1, x: 385.3, y: 285.6, size: 8 },

      { key: "local", page: 5, x: 102.7, y: 659.1, size: 9, maxWidth: 229 },
      { key: "data", page: 5, x: 366.7, y: 659.1, size: 9, maxWidth: 134 },
    ],
  },

  {
    slug: "requerimento-loas",
    label: "Requerimento LOAS / BPC (Anexo I)",
    descricao: "Requerimento do BPC e composição do grupo familiar.",
    file: "/documentos-templates/requerimento-loas.pdf",
    campos: [
      { key: "cpf", label: "CPF do requerente", source: "clienteCpf" },
      { key: "nome", label: "Nome do requerente", source: "clienteNome", colSpan: 2 },
      { key: "nascimentoDia", label: "Nasc. dia", source: "clienteNascimentoDia" },
      { key: "nascimentoMes", label: "Nasc. mês", source: "clienteNascimentoMes" },
      { key: "nascimentoAno", label: "Nasc. ano", source: "clienteNascimentoAno" },
      {
        key: "tipo",
        label: "Tipo de BPC",
        tipo: "opcao",
        opcoes: [
          { value: "", label: "— não marcar —" },
          { value: "deficiencia", label: "Pessoa com deficiência" },
          { value: "idosa", label: "Pessoa idosa" },
        ],
      },
      { key: "endereco", label: "Endereço", colSpan: 2 },
      { key: "email", label: "E-mail" },
      { key: "bairro", label: "Bairro" },
      { key: "municipio", label: "Município" },
      { key: "uf", label: "UF", default: "MA" },
      { key: "cep", label: "CEP" },
      { key: "telefoneDdd", label: "DDD", source: "clienteTelefoneDdd" },
      { key: "telefoneNumero", label: "Telefone", source: "clienteTelefoneNumero" },
      {
        key: "estadoCivil",
        label: "Estado civil",
        tipo: "opcao",
        opcoes: [
          { value: "", label: "— não marcar —" },
          { value: "solteiro", label: "Solteiro" },
          { value: "casado", label: "Casado" },
          { value: "uniao", label: "União estável" },
          { value: "divorciado", label: "Divorciado" },
          { value: "separado", label: "Separado de fato" },
          { value: "viuvo", label: "Viúvo" },
        ],
      },
      { key: "local", label: "Local (assinatura)", placeholder: "São Luís/MA", colSpan: 2 },
      { key: "dataDia", label: "Dia", source: "hojeDia" },
      { key: "dataMes", label: "Mês", source: "hojeMes" },
      { key: "dataAno", label: "Ano", source: "hojeAno" },
    ],
    placements: [
      { key: "cpf", page: 1, x: 126, y: 778, size: 9, maxWidth: 117 },
      { key: "nome", page: 1, x: 136, y: 764, size: 9, maxWidth: 303 },
      { key: "nascimentoDia", page: 1, x: 503, y: 764, size: 8, maxWidth: 17 },
      { key: "nascimentoMes", page: 1, x: 527, y: 764, size: 8, maxWidth: 9 },
      { key: "nascimentoAno", page: 1, x: 541, y: 764, size: 8, maxWidth: 25 },

      { key: "tipo", when: "deficiencia", text: "X", page: 1, x: 265, y: 781.7, size: 8 },
      { key: "tipo", when: "idosa", text: "X", page: 1, x: 451.5, y: 781.7, size: 8 },

      { key: "endereco", page: 1, x: 81, y: 740.7, size: 8, maxWidth: 306 },
      { key: "email", page: 1, x: 413, y: 742.5, size: 8, maxWidth: 160 },
      { key: "bairro", page: 1, x: 71, y: 731.5, size: 8, maxWidth: 108 },
      { key: "municipio", page: 1, x: 224, y: 731.5, size: 8, maxWidth: 103 },
      { key: "uf", page: 1, x: 345, y: 731.5, size: 8, maxWidth: 21 },
      { key: "cep", page: 1, x: 388, y: 731.5, size: 8, maxWidth: 60 },
      { key: "telefoneDdd", page: 1, x: 489, y: 731.5, size: 8, maxWidth: 12 },
      { key: "telefoneNumero", page: 1, x: 505, y: 731.5, size: 8, maxWidth: 71 },

      { key: "estadoCivil", when: "solteiro", text: "X", page: 1, x: 113, y: 716.7, size: 8 },
      { key: "estadoCivil", when: "casado", text: "X", page: 1, x: 173, y: 716.7, size: 8 },
      { key: "estadoCivil", when: "uniao", text: "X", page: 1, x: 231, y: 716.7, size: 8 },
      { key: "estadoCivil", when: "divorciado", text: "X", page: 1, x: 321, y: 716.7, size: 8 },
      { key: "estadoCivil", when: "separado", text: "X", page: 1, x: 395, y: 716.7, size: 8 },
      { key: "estadoCivil", when: "viuvo", text: "X", page: 1, x: 501, y: 716.7, size: 8 },

      { key: "local", page: 1, x: 65, y: 72.4, size: 9, maxWidth: 170 },
      { key: "dataDia", page: 1, x: 264, y: 72.4, size: 8, maxWidth: 9 },
      { key: "dataMes", page: 1, x: 279, y: 72.4, size: 8, maxWidth: 11 },
      { key: "dataAno", page: 1, x: 297, y: 72.4, size: 8, maxWidth: 25 },
    ],
  },
];

const POR_SLUG = new Map(DOCUMENTOS_TEMPLATES.map((t) => [t.slug, t]));

export function getDocumentoTemplate(slug: string): DocumentoTemplate | undefined {
  return POR_SLUG.get(slug);
}

export function isDocumentoSlug(slug: string): boolean {
  return POR_SLUG.has(slug);
}

/** Dados do caso/cliente usados para pré-preencher os campos. */
export type DadosDocumento = {
  clienteNome: string;
  clienteCpf: string;
  clienteNascimento: string | null;
  clienteTelefone: string;
  beneficio: string;
  escritorioNome: string;
  voltarHref: string;
};

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function partesData(iso: string | null): [string, string, string] {
  if (!iso) return ["", "", ""];
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return [m[3], m[2], m[1]];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ["", "", ""];
  return [
    String(d.getDate()).padStart(2, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getFullYear()),
  ];
}

export function valorDaFonte(
  fonte: FonteCampo,
  dados: DadosDocumento,
  hoje = new Date()
): string {
  const [nd, nm, na] = partesData(dados.clienteNascimento);
  const dia = String(hoje.getDate()).padStart(2, "0");
  const mes = String(hoje.getMonth() + 1).padStart(2, "0");
  const ano = String(hoje.getFullYear());
  const tel = normalizePhone(dados.clienteTelefone).replace(/^55/, "");

  switch (fonte) {
    case "clienteNome":
      return dados.clienteNome;
    case "clienteCpf":
      return dados.clienteCpf ? formatCpf(dados.clienteCpf) : "";
    case "clienteCpfDigitos":
      return normalizeCpf(dados.clienteCpf);
    case "clienteNascimento":
      return nd ? `${nd}/${nm}/${na}` : "";
    case "clienteNascimentoDia":
      return nd;
    case "clienteNascimentoMes":
      return nm;
    case "clienteNascimentoAno":
      return na;
    case "clienteTelefone":
      return dados.clienteTelefone;
    case "clienteTelefoneDdd":
      return tel.slice(0, 2);
    case "clienteTelefoneNumero": {
      const resto = tel.slice(2);
      if (resto.length < 8) return resto;
      return `${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
    }
    case "beneficio":
      return dados.beneficio;
    case "escritorio":
      return dados.escritorioNome;
    case "hoje":
      return `${dia} de ${MESES[hoje.getMonth()]} de ${ano}`;
    case "hojeDia":
      return dia;
    case "hojeMes":
      return mes;
    case "hojeMesExtenso":
      return MESES[hoje.getMonth()];
    case "hojeAno":
      return ano;
    default:
      return "";
  }
}

/** Valores iniciais de todos os campos do template. */
export function valoresIniciais(
  template: DocumentoTemplate,
  dados: DadosDocumento
): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const campo of template.campos) {
    valores[campo.key] = campo.source
      ? valorDaFonte(campo.source, dados) || campo.default || ""
      : campo.default ?? "";
  }
  for (const campo of template.campos) {
    if (campo.template) valores[campo.key] = aplicarTemplate(campo.template, valores);
  }
  return valores;
}

export function aplicarTemplate(
  template: string,
  valores: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = valores[key];
    return v && v.trim() ? v.trim() : "__________";
  });
}
