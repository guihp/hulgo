import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PROJECT_REF = "hzfvciamevimjzuvidcp";

type TipoPublico = {
  chave: string;
  label: string;
  aliases: string[];
  documentos: string[];
};

type TipoMatch = TipoPublico & {
  ativo: boolean;
  ordem: number;
};

/** Seed em memória se a tabela estiver vazia (mesmo conteúdo da migration). */
const FALLBACK_TIPOS: TipoMatch[] = [
  {
    chave: "bpc_loas",
    label: "BPC/LOAS",
    aliases: ["bpc", "loas"],
    documentos: [
      "RG ou CNH",
      "CPF",
      "Comprovante de residência",
      "CadÚnico atualizado (folha resumo)",
      "Comprovante de renda de todos do grupo familiar",
      "Laudos e exames médicos (se deficiência)",
      "Receitas de medicamentos de uso contínuo",
      "CNIS de todos do grupo familiar",
    ],
    ativo: true,
    ordem: 10,
  },
  {
    chave: "pensao_morte",
    label: "Pensão por morte",
    aliases: ["pensão", "pensao", "morte"],
    documentos: [
      "RG ou CNH",
      "CPF",
      "Comprovante de residência",
      "Certidão de óbito",
      "Certidão de casamento ou prova de união estável",
      "Certidão de nascimento dos filhos menores",
      "CNIS do falecido",
      "Provas de dependência econômica (se não presumida)",
    ],
    ativo: true,
    ordem: 20,
  },
  {
    chave: "salario_maternidade",
    label: "Salário-maternidade",
    aliases: ["maternidade"],
    documentos: [
      "RG ou CNH",
      "CPF",
      "Comprovante de residência",
      "Certidão de nascimento da criança",
      "CNIS",
      "Provas de atividade rural no período (se rural)",
    ],
    ativo: true,
    ordem: 30,
  },
  {
    chave: "incapacidade",
    label: "Auxílio por incapacidade temporária",
    aliases: [
      "incapacidade",
      "auxílio-doença",
      "auxilio-doenca",
      "doença",
      "doenca",
      "invalidez",
    ],
    documentos: [
      "RG ou CNH",
      "CPF",
      "Comprovante de residência",
      "Laudos médicos recentes (com CID)",
      "Exames de imagem/laboratoriais",
      "Atestados de afastamento",
      "Receitas médicas",
      "CNIS",
      "Comunicação de acidente de trabalho — CAT (se acidente)",
    ],
    ativo: true,
    ordem: 40,
  },
  {
    chave: "rural_idade",
    label: "Aposentadoria rural por idade",
    aliases: ["rural"],
    documentos: [
      "RG ou CNH",
      "CPF",
      "Comprovante de residência",
      "Autodeclaração de atividade rural",
      "CAF/DAP (ou extrato)",
      "Notas fiscais de venda de produção",
      "Contrato de arrendamento/parceria (se houver)",
      "Certidão de casamento (profissão lavrador)",
      "Ficha de sindicato rural / declaração",
      "CNIS",
    ],
    ativo: true,
    ordem: 50,
  },
  {
    chave: "urbana_idade",
    label: "Aposentadoria urbana por idade",
    aliases: ["aposentadoria", "idade", "urbana"],
    documentos: [
      "RG ou CNH",
      "CPF",
      "Comprovante de residência",
      "CNIS",
      "Carteira de trabalho (todas as páginas de contrato)",
      "Carnês de contribuição (se autônomo)",
      "PPP/laudos (se atividade especial)",
    ],
    ativo: true,
    ordem: 60,
  },
  {
    chave: "outro",
    label: "Outro benefício",
    aliases: ["outro"],
    documentos: ["RG ou CNH", "CPF", "Comprovante de residência", "CNIS"],
    ativo: true,
    ordem: 90,
  },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  const apikey = req.headers.get("apikey");
  if (apikey?.trim()) return apikey.trim();
  return null;
}

function isServiceRoleJwt(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return payload.role === "service_role" && payload.ref === PROJECT_REF;
  } catch {
    return false;
  }
}

function verifyServiceRole(req: Request): string | null {
  const token = extractToken(req);
  if (!token) return null;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (serviceRoleKey && token === serviceRoleKey) return token;
  if (isServiceRoleJwt(token)) return token;
  return null;
}

function publicTipo(t: TipoMatch): TipoPublico {
  return {
    chave: t.chave,
    label: t.label,
    aliases: t.aliases,
    documentos: t.documentos,
  };
}

function matchTipoCaso(tipos: TipoMatch[], beneficio: string): TipoMatch {
  const ativos = tipos.filter((t) => t.ativo);
  const b = beneficio.toLowerCase().trim();
  const outro =
    ativos.find((t) => t.chave === "outro") ??
    FALLBACK_TIPOS.find((t) => t.chave === "outro")!;

  if (!b) return outro;

  for (const tipo of ativos) {
    if (tipo.chave === "outro") continue;
    const aliases = tipo.aliases.length
      ? tipo.aliases
      : [tipo.label, tipo.chave];
    for (const alias of aliases) {
      const a = alias.toLowerCase().trim();
      if (a && b.includes(a)) return tipo;
    }
    const label = tipo.label.toLowerCase();
    if (label && b.includes(label)) return tipo;
  }

  return outro;
}

async function readBeneficio(req: Request): Promise<string | null> {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("beneficio");
  if (fromQuery != null) return fromQuery;

  if (req.method === "POST") {
    try {
      const body = await req.json() as Record<string, unknown>;
      const v = body.beneficio;
      if (typeof v === "string") return v;
    } catch {
      // body opcional
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const serviceRoleKey = verifyServiceRole(req);
  if (!serviceRoleKey) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  const beneficio = await readBeneficio(req);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("app_tipos_caso")
    .select("chave, label, aliases, documentos, ativo, ordem")
    .eq("ativo", true)
    .order("ordem", { ascending: true })
    .order("label", { ascending: true });

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  const tipos: TipoMatch[] =
    data && data.length > 0
      ? data.map((row) => ({
        chave: row.chave,
        label: row.label,
        aliases: row.aliases ?? [],
        documentos: row.documentos ?? [],
        ativo: row.ativo ?? true,
        ordem: row.ordem ?? 100,
      }))
      : FALLBACK_TIPOS;

  if (beneficio != null && beneficio.trim() !== "") {
    const match = matchTipoCaso(tipos, beneficio);
    return jsonResponse({
      match: publicTipo(match),
      beneficio: beneficio.trim(),
    });
  }

  return jsonResponse({
    tipos: tipos.map(publicTipo),
  });
});
