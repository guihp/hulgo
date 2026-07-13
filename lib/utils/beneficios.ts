import { differenceInYears } from "date-fns";
import type { PrazoTipo } from "@/types/database";

export const PRAZO_TIPOS: { value: PrazoTipo; label: string }[] = [
  { value: "exigencia_inss", label: "Exigência INSS" },
  { value: "recurso", label: "Recurso" },
  { value: "pericia", label: "Perícia" },
  { value: "audiencia", label: "Audiência" },
  { value: "outro", label: "Outro" },
];

/* ---------------- Checklist de documentos por benefício ---------------- */

export type BeneficioChave =
  | "rural_idade"
  | "urbana_idade"
  | "bpc_loas"
  | "pensao_morte"
  | "incapacidade"
  | "salario_maternidade"
  | "outro";

const DOCS_BASE = ["RG ou CNH", "CPF", "Comprovante de residência"];

export const CHECKLIST_POR_BENEFICIO: Record<
  BeneficioChave,
  { label: string; docs: string[] }
> = {
  rural_idade: {
    label: "Aposentadoria rural por idade",
    docs: [
      ...DOCS_BASE,
      "Autodeclaração de atividade rural",
      "CAF/DAP (ou extrato)",
      "Notas fiscais de venda de produção",
      "Contrato de arrendamento/parceria (se houver)",
      "Certidão de casamento (profissão lavrador)",
      "Ficha de sindicato rural / declaração",
      "CNIS",
    ],
  },
  urbana_idade: {
    label: "Aposentadoria urbana por idade",
    docs: [
      ...DOCS_BASE,
      "CNIS",
      "Carteira de trabalho (todas as páginas de contrato)",
      "Carnês de contribuição (se autônomo)",
      "PPP/laudos (se atividade especial)",
    ],
  },
  bpc_loas: {
    label: "BPC/LOAS",
    docs: [
      ...DOCS_BASE,
      "CadÚnico atualizado (folha resumo)",
      "Comprovante de renda de todos do grupo familiar",
      "Laudos e exames médicos (se deficiência)",
      "Receitas de medicamentos de uso contínuo",
      "CNIS de todos do grupo familiar",
    ],
  },
  pensao_morte: {
    label: "Pensão por morte",
    docs: [
      ...DOCS_BASE,
      "Certidão de óbito",
      "Certidão de casamento ou prova de união estável",
      "Certidão de nascimento dos filhos menores",
      "CNIS do falecido",
      "Provas de dependência econômica (se não presumida)",
    ],
  },
  incapacidade: {
    label: "Auxílio por incapacidade temporária",
    docs: [
      ...DOCS_BASE,
      "Laudos médicos recentes (com CID)",
      "Exames de imagem/laboratoriais",
      "Atestados de afastamento",
      "Receitas médicas",
      "CNIS",
      "Comunicação de acidente de trabalho — CAT (se acidente)",
    ],
  },
  salario_maternidade: {
    label: "Salário-maternidade",
    docs: [
      ...DOCS_BASE,
      "Certidão de nascimento da criança",
      "CNIS",
      "Provas de atividade rural no período (se rural)",
    ],
  },
  outro: {
    label: "Outro benefício",
    docs: [...DOCS_BASE, "CNIS"],
  },
};

/** Mapeia o texto livre `beneficio_identificado` para a chave do checklist. */
export function chaveDoBeneficio(beneficio: string | null | undefined): BeneficioChave {
  const b = (beneficio ?? "").toLowerCase();
  if (!b) return "outro";
  if (b.includes("bpc") || b.includes("loas")) return "bpc_loas";
  if (b.includes("pensão") || b.includes("pensao") || b.includes("morte"))
    return "pensao_morte";
  if (b.includes("maternidade")) return "salario_maternidade";
  if (
    b.includes("incapacidade") ||
    b.includes("auxílio-doença") ||
    b.includes("auxilio-doenca") ||
    b.includes("doença") ||
    b.includes("doenca") ||
    b.includes("invalidez")
  )
    return "incapacidade";
  if (b.includes("rural")) return "rural_idade";
  if (b.includes("aposentadoria") || b.includes("idade") || b.includes("urbana"))
    return "urbana_idade";
  return "outro";
}

/* ---------------- Requisito etário ---------------- */

export type RequisitoEtario = {
  idade: number;
  requisito: string;
  /** true = atingiu com folga; false = claramente não; null = depende (ex.: sexo) */
  atingido: boolean | null;
};

export function avaliarRequisitoEtario(
  dataNascimento: string | null | undefined,
  beneficio: string | null | undefined
): RequisitoEtario | null {
  if (!dataNascimento) return null;
  const idade = differenceInYears(new Date(), new Date(dataNascimento + "T12:00:00"));
  if (Number.isNaN(idade) || idade < 0 || idade > 130) return null;

  const chave = chaveDoBeneficio(beneficio);

  switch (chave) {
    case "rural_idade":
      return {
        idade,
        requisito: "rural: 55 (mulher) / 60 (homem)",
        atingido: idade >= 60 ? true : idade < 55 ? false : null,
      };
    case "urbana_idade":
      return {
        idade,
        requisito: "urbana: 62 (mulher) / 65 (homem)",
        atingido: idade >= 65 ? true : idade < 62 ? false : null,
      };
    case "bpc_loas": {
      const beneficioTexto = (beneficio ?? "").toLowerCase();
      const porIdade =
        beneficioTexto.includes("idoso") || beneficioTexto.includes("idade");
      if (porIdade || !beneficioTexto.includes("defici")) {
        return {
          idade,
          requisito: "BPC idoso: 65 anos (qualquer sexo)",
          atingido: idade >= 65,
        };
      }
      return {
        idade,
        requisito: "BPC deficiência: sem requisito de idade",
        atingido: null,
      };
    }
    default:
      return null;
  }
}
