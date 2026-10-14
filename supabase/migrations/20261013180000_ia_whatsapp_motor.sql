-- IA do WhatsApp rodando no próprio sistema (substitui o fluxo n8n).
--   app_ia_whatsapp_config  linha única: modo (desligado|teste|publico), números de teste,
--                           grupo/números do advogado, token do webhook da EvoGo.
--   app_ia_estado           por telefone: pausa (antigo block no Redis), início da memória,
--                           última mensagem do cliente já respondida.
--   app_ia_fila             debounce: cada mensagem nova adia processar_apos; o worker
--                           pega a vez com FOR UPDATE SKIP LOCKED (sem execução dupla).
--   app_ia_execucoes        log de cada resposta (entrada, ferramentas, saída, erro).
--   mensagens.ia_conteudo   como a IA leu a mensagem (transcrição/descrição/texto extraído).

-- ---------------------------------------------------------------- config
CREATE TABLE IF NOT EXISTS public.app_ia_whatsapp_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  modo text NOT NULL DEFAULT 'teste' CHECK (modo IN ('desligado', 'teste', 'publico')),
  numeros_teste text[] NOT NULL DEFAULT '{}',
  usar_rascunho_no_teste boolean NOT NULL DEFAULT false,
  debounce_segundos integer NOT NULL DEFAULT 15 CHECK (debounce_segundos BETWEEN 3 AND 120),
  grupo_advogado text,
  numeros_advogado text[] NOT NULL DEFAULT '{}',
  webhook_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

COMMENT ON TABLE public.app_ia_whatsapp_config IS
  'Motor de IA do WhatsApp (linha única). modo=teste responde só numeros_teste.';

INSERT INTO public.app_ia_whatsapp_config (id, modo, numeros_teste, grupo_advogado, numeros_advogado)
VALUES (
  1,
  'teste',
  -- Mesmos números liberados no fluxo n8n (nó If3), já normalizados com o 9º dígito.
  ARRAY['5519981941604', '5598988758339', '5598981753723', '5598981378076', '5598984868863'],
  '120363411133397903@g.us',
  ARRAY['5598981753723']
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_ia_whatsapp_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_ia_whatsapp_config_select ON public.app_ia_whatsapp_config
  FOR SELECT TO authenticated
  USING (app_private.is_advogado());

REVOKE ALL ON public.app_ia_whatsapp_config FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.app_ia_whatsapp_config FROM authenticated;

-- ---------------------------------------------------------------- estado por telefone
CREATE TABLE IF NOT EXISTS public.app_ia_estado (
  telefone text PRIMARY KEY,
  pausada boolean NOT NULL DEFAULT false,
  pausada_em timestamptz,
  pausada_motivo text,
  memoria_desde timestamptz,
  ultima_mensagem_id bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_ia_estado IS
  'Estado da IA por telefone (dígitos normalizados). pausada = atendimento humano.';

ALTER TABLE public.app_ia_estado ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_ia_estado_select ON public.app_ia_estado
  FOR SELECT TO authenticated
  USING (app_private.is_authenticated_user());

REVOKE ALL ON public.app_ia_estado FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.app_ia_estado FROM authenticated;

-- ---------------------------------------------------------------- fila (debounce)
CREATE TABLE IF NOT EXISTS public.app_ia_fila (
  telefone text PRIMARY KEY,
  instancia text,
  processar_apos timestamptz NOT NULL,
  travado_em timestamptz,
  tentativas integer NOT NULL DEFAULT 0,
  ultimo_erro text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_ia_fila_processar_idx ON public.app_ia_fila (processar_apos);

ALTER TABLE public.app_ia_fila ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_ia_fila_select ON public.app_ia_fila
  FOR SELECT TO authenticated
  USING (app_private.is_authenticated_user());

REVOKE ALL ON public.app_ia_fila FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.app_ia_fila FROM authenticated;

-- ---------------------------------------------------------------- log de execuções
CREATE TABLE IF NOT EXISTS public.app_ia_execucoes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  telefone text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'erro', 'pausada', 'sem_resposta')),
  entrada text,
  respostas jsonb NOT NULL DEFAULT '[]'::jsonb,
  ferramentas jsonb NOT NULL DEFAULT '[]'::jsonb,
  modelo text,
  prompt_origem text,
  duracao_ms integer,
  erro text
);

CREATE INDEX IF NOT EXISTS app_ia_execucoes_created_idx ON public.app_ia_execucoes (created_at DESC);
CREATE INDEX IF NOT EXISTS app_ia_execucoes_telefone_idx ON public.app_ia_execucoes (telefone, created_at DESC);

ALTER TABLE public.app_ia_execucoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_ia_execucoes_select ON public.app_ia_execucoes
  FOR SELECT TO authenticated
  USING (app_private.is_authenticated_user());

REVOKE ALL ON public.app_ia_execucoes FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.app_ia_execucoes FROM authenticated;

SELECT cron.schedule(
  'limpar-ia-execucoes',
  '23 4 * * *',
  $$DELETE FROM public.app_ia_execucoes WHERE created_at < now() - interval '60 days'$$
);

-- ---------------------------------------------------------------- mensagens
ALTER TABLE public.mensagens ADD COLUMN IF NOT EXISTS ia_conteudo text;

COMMENT ON COLUMN public.mensagens.ia_conteudo IS
  'Conteúdo como a IA leu (texto, transcrição de áudio/vídeo, descrição de imagem, texto de documento).';

-- ---------------------------------------------------------------- RPCs da fila (service_role)
CREATE OR REPLACE FUNCTION public.ia_fila_agendar(
  p_telefone text,
  p_instancia text,
  p_segundos integer
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.app_ia_fila (telefone, instancia, processar_apos)
  VALUES (p_telefone, p_instancia, now() + make_interval(secs => p_segundos))
  ON CONFLICT (telefone) DO UPDATE
    SET processar_apos = now() + make_interval(secs => p_segundos),
        instancia = coalesce(EXCLUDED.instancia, app_ia_fila.instancia);
$$;

-- Pega até p_limite telefones vencidos. Trava expirada (5 min) é retomada.
CREATE OR REPLACE FUNCTION public.ia_fila_pegar(p_limite integer DEFAULT 5)
RETURNS TABLE (telefone text, instancia text, processar_apos timestamptz, tentativas integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH alvo AS (
    SELECT f.telefone
      FROM public.app_ia_fila f
     WHERE f.processar_apos <= now()
       AND (f.travado_em IS NULL OR f.travado_em < now() - interval '5 minutes')
     ORDER BY f.processar_apos
     LIMIT p_limite
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.app_ia_fila f
     SET travado_em = now(), tentativas = f.tentativas + 1
    FROM alvo
   WHERE f.telefone = alvo.telefone
  RETURNING f.telefone, f.instancia, f.processar_apos, f.tentativas;
$$;

-- Conclui: sem erro apaga (se não chegou mensagem nova durante o processamento);
-- com erro reagenda em 30 s até 3 tentativas.
CREATE OR REPLACE FUNCTION public.ia_fila_concluir(
  p_telefone text,
  p_processar_apos timestamptz,
  p_erro text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tentativas integer;
BEGIN
  IF p_erro IS NULL THEN
    DELETE FROM public.app_ia_fila
     WHERE telefone = p_telefone AND processar_apos = p_processar_apos;
    IF NOT FOUND THEN
      UPDATE public.app_ia_fila
         SET travado_em = NULL, tentativas = 0, ultimo_erro = NULL
       WHERE telefone = p_telefone;
    END IF;
    RETURN;
  END IF;

  SELECT tentativas INTO v_tentativas FROM public.app_ia_fila WHERE telefone = p_telefone;
  IF coalesce(v_tentativas, 0) >= 3 THEN
    DELETE FROM public.app_ia_fila WHERE telefone = p_telefone;
  ELSE
    UPDATE public.app_ia_fila
       SET travado_em = NULL,
           ultimo_erro = left(p_erro, 1000),
           processar_apos = greatest(processar_apos, now() + interval '30 seconds')
     WHERE telefone = p_telefone;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ia_fila_agendar(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ia_fila_pegar(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ia_fila_concluir(text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_fila_agendar(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ia_fila_pegar(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ia_fila_concluir(text, timestamptz, text) TO service_role;

-- Página /ia-whatsapp acompanha execuções e pausas ao vivo.
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_ia_execucoes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_ia_estado;
