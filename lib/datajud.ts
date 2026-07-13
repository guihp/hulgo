import "server-only";

/**
 * Consulta pública DataJud/CNJ por número de processo.
 * Docs: https://datajud-wiki.cnj.jus.br/api-publica/
 * A chave pública oficial pode ser sobrescrita via env DATAJUD_API_KEY
 * (se o CNJ rotacionar, pegar nova em datajud-wiki.cnj.jus.br/api-publica/acesso).
 */
const DATAJUD_API_KEY =
  process.env.DATAJUD_API_KEY?.trim() ||
  "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ATTEMPT_TIMEOUT_MS = 25_000;

async function fetchDataJud(url: string, body: string): Promise<Response> {
  const maxRetries = 3;
  const retryable = new Set([429, 502, 503, 504]);
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Timeout por tentativa — a API do CNJ trava com frequência; um timeout
    // global engoliria as tentativas seguintes.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `APIKey ${DATAJUD_API_KEY}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
        cache: "no-store",
      });

      if (!retryable.has(res.status) || attempt === maxRetries) return res;

      const retryAfterHeader = Number(res.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : (attempt + 1) * 4000;
      await sleep(waitMs);
    } catch (err) {
      // Timeout ou queda de rede também merecem retry
      lastError = err;
      if (attempt === maxRetries) throw err;
      await sleep((attempt + 1) * 2000);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("Falha inesperada ao consultar DataJud");
}

/** J.TR (posições do número CNJ) → alias do índice DataJud. */
export function resolverAliasDataJud(numeroProcesso: string): string | null {
  const digits = numeroProcesso.replace(/\D/g, "");
  if (digits.length !== 20) return null;
  return aliasDoTribunal(digits.charAt(13), digits.slice(14, 16));
}

function aliasDoTribunal(j: string, tr: string): string | null {
  if (j === "4") return `trf${Number(tr)}`; // Justiça Federal (TRF1..6)
  if (j === "8") {
    const tjs: Record<string, string> = {
      "01": "tjac", "02": "tjal", "03": "tjap", "04": "tjam", "05": "tjba",
      "06": "tjce", "07": "tjdft", "08": "tjes", "09": "tjgo", "10": "tjma",
      "11": "tjmt", "12": "tjms", "13": "tjmg", "14": "tjpa", "15": "tjpb",
      "16": "tjpr", "17": "tjpe", "18": "tjpi", "19": "tjrj", "20": "tjrn",
      "21": "tjrs", "22": "tjro", "23": "tjrr", "24": "tjsc", "25": "tjse",
      "26": "tjsp", "27": "tjto",
    };
    return tjs[tr] ?? null;
  }
  if (j === "5") return `trt${Number(tr)}`; // Justiça do Trabalho
  return null;
}

export type MovimentoDataJud = {
  data: string;
  nome: string;
  complemento?: string;
};

export type ResultadoDataJud =
  | {
      encontrado: true;
      tribunal: string;
      classe: string | null;
      orgaoJulgador: string | null;
      grau: string | null;
      dataAjuizamento: string | null;
      ultimaAtualizacao: string | null;
      assuntos: string[];
      movimentos: MovimentoDataJud[];
    }
  | { encontrado: false; motivo: string };

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; result: ResultadoDataJud }>();

type HitDataJud = {
  _source?: {
    tribunal?: string;
    grau?: string;
    dataAjuizamento?: string;
    dataHoraUltimaAtualizacao?: string;
    classe?: { nome?: string };
    orgaoJulgador?: { nome?: string };
    assuntos?: { nome?: string }[];
    movimentos?: {
      dataHora?: string;
      nome?: string;
      complementosTabelados?: { nome?: string; descricao?: string }[];
    }[];
  };
};

export async function consultarDataJud(
  numeroProcesso: string
): Promise<ResultadoDataJud> {
  const digits = numeroProcesso.replace(/\D/g, "");
  if (digits.length !== 20) {
    return { encontrado: false, motivo: "Número de processo CNJ inválido" };
  }

  const cached = cache.get(digits);
  if (cached && cached.result.encontrado && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result;
  }

  const j = digits.charAt(13);
  const tr = digits.slice(14, 16);
  const alias = aliasDoTribunal(j, tr);
  if (!alias) {
    return {
      encontrado: false,
      motivo: `Tribunal não suportado (segmento ${j}, TR ${tr})`,
    };
  }

  const body = JSON.stringify({
    size: 5,
    query: { term: { "numeroProcesso.keyword": digits } },
  });

  try {
    const res = await fetchDataJud(
      `https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`,
      body
    );

    if (res.status === 401) {
      return {
        encontrado: false as const,
        motivo:
          "Chave da API DataJud expirada — obtenha uma nova em datajud-wiki.cnj.jus.br/api-publica/acesso e configure DATAJUD_API_KEY",
      };
    }
    if (res.status === 429) {
      return {
        encontrado: false as const,
        motivo:
          "Limite de consultas do CNJ atingido (muitas requisições na API pública). Aguarde 1–2 minutos e clique em Atualizar novamente.",
      };
    }
    if (res.status === 504 || res.status === 502 || res.status === 503) {
      return {
        encontrado: false as const,
        motivo:
          "API do CNJ temporariamente indisponível (servidor demorou a responder). Tente novamente em alguns minutos.",
      };
    }
    if (!res.ok) {
      return {
        encontrado: false as const,
        motivo: `DataJud respondeu ${res.status}`,
      };
    }

    const payload = (await res.json()) as { hits?: { hits?: HitDataJud[] } };
    const hits = payload.hits?.hits ?? [];
    if (hits.length === 0) {
      return {
        encontrado: false as const,
        motivo:
          "Processo não encontrado no DataJud (pode estar em segredo de justiça ou o tribunal ainda não publicou os dados)",
      };
    }

    // Pega o hit com atualização mais recente (processos aparecem 1x por grau)
    const source = hits
      .map((h) => h._source)
      .filter(Boolean)
      .sort((a, b) =>
        String(b?.dataHoraUltimaAtualizacao ?? "").localeCompare(
          String(a?.dataHoraUltimaAtualizacao ?? "")
        )
      )[0]!;

    const movimentos = (source.movimentos ?? [])
      .map((m) => ({
        data: m.dataHora ?? "",
        nome: m.nome ?? "",
        complemento: m.complementosTabelados
          ?.map((c) => c.nome ?? c.descricao ?? "")
          .filter(Boolean)
          .join(", "),
      }))
      .filter((m) => m.nome)
      .sort((a, b) => b.data.localeCompare(a.data))
      .slice(0, 20);

    const result = {
      encontrado: true as const,
      tribunal: source.tribunal ?? alias.toUpperCase(),
      classe: source.classe?.nome ?? null,
      orgaoJulgador: source.orgaoJulgador?.nome ?? null,
      grau: source.grau ?? null,
      dataAjuizamento: source.dataAjuizamento ?? null,
      ultimaAtualizacao: source.dataHoraUltimaAtualizacao ?? null,
      assuntos: (source.assuntos ?? [])
        .map((a) => a.nome ?? "")
        .filter(Boolean),
      movimentos,
    };
    cache.set(digits, { at: Date.now(), result });
    return result;
  } catch (err) {
    return {
      encontrado: false as const,
      motivo:
        err instanceof Error && err.name === "AbortError"
          ? "DataJud demorou a responder (timeout em 4 tentativas de 25s) — a API do CNJ está lenta. Tente novamente em alguns minutos."
          : "Falha de rede ao consultar o DataJud",
    };
  }
}
