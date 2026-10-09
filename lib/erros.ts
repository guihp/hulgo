/**
 * Tradução de erros para texto de usuário — usado no servidor (log em
 * app_erros_log) e no cliente (toasts). Sem imports de servidor/cliente.
 */

/** Texto que o Next/React devolve em produção no lugar do erro real. */
const RE_GENERICO_PRODUCAO =
  /Server Components render|specific message is omitted|An error occurred in the Server/i;

export function isErroGenericoProducao(msg: string): boolean {
  return RE_GENERICO_PRODUCAO.test(msg);
}

/** Erros técnicos conhecidos (Postgres, PostgREST, Auth, rede) → português. */
const REGRAS: [RegExp, string][] = [
  [
    /JWT expired|invalid jwt|refresh token|Auth session missing|Não autenticado|not authenticated/i,
    "Sua sessão expirou. Saia e entre de novo no sistema.",
  ],
  [
    /row-level security|permission denied|42501|insufficient_privilege/i,
    "Sem permissão para essa ação. Saia e entre de novo; se continuar, fale com o suporte.",
  ],
  [/duplicate key|unique constraint|23505/i, "Esse registro já existe (duplicado)."],
  [
    /foreign key|23503/i,
    "Esse registro está ligado a outro que não existe mais (ou ainda está em uso).",
  ],
  [/not-null constraint|null value in column|23502/i, "Falta preencher um campo obrigatório."],
  [/check constraint|23514/i, "Algum valor informado não é aceito nesse campo."],
  [/invalid input syntax|22P02|22007|22008/i, "Algum valor está em formato inválido (data, número ou CPF)."],
  [/value too long|22001/i, "Algum texto ficou maior que o permitido."],
  [
    /statement timeout|57014|timed out|timeout|ETIMEDOUT|AbortError|aborted/i,
    "A operação demorou demais e foi cancelada. Tente de novo.",
  ],
  [
    /fetch failed|Failed to fetch|NetworkError|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up|network/i,
    "Falha de conexão com o servidor. Verifique a internet e tente de novo.",
  ],
  [
    /Body exceeded|too large|payload|413/i,
    "Arquivo ou mensagem grande demais para enviar de uma vez.",
  ],
  [/rate limit|too many requests|429/i, "Muitas tentativas seguidas. Aguarde um minuto e tente de novo."],
  [
    /SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE|OPENAI_API_KEY|não configurada/i,
    "Configuração do servidor incompleta. Avise o suporte.",
  ],
];

/** Mensagem que o próprio app lança em português (ex.: "Prazo não encontrado"). */
function pareceMensagemDoApp(msg: string): boolean {
  if (msg.length > 300) return false;
  return /[áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]|\b(não|nao|para|com|sem|foi|está|esta|inválid|obrigat)/i.test(
    msg
  );
}

/**
 * Texto para o usuário a partir da mensagem original do erro.
 * Técnico conhecido → tradução; já em português → como está; desconhecido → null.
 */
export function mensagemParaUsuario(msg: string): string | null {
  const texto = msg.trim();
  if (!texto || isErroGenericoProducao(texto)) return null;
  for (const [re, traducao] of REGRAS) {
    if (re.test(texto)) return traducao;
  }
  return pareceMensagemDoApp(texto) ? texto : null;
}
