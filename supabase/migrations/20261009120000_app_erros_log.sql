-- Log de erros do servidor (Next onRequestError → lib/erros-log.ts).
-- O digest é o código que aparece na tela; /api/erros/{digest} devolve só
-- mensagem_usuario (texto traduzido). Limpeza: 90 dias.
CREATE TABLE IF NOT EXISTS public.app_erros_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  digest text,
  origem text,
  rota text,
  metodo text,
  action_id text,
  mensagem text NOT NULL,
  mensagem_usuario text,
  stack text
);

COMMENT ON TABLE public.app_erros_log IS
  'Erros capturados pelo Next (render, Server Action, rota). Escrita só pela service_role.';

CREATE INDEX IF NOT EXISTS app_erros_log_digest_idx ON public.app_erros_log (digest);
CREATE INDEX IF NOT EXISTS app_erros_log_created_idx ON public.app_erros_log (created_at DESC);

ALTER TABLE public.app_erros_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_erros_log_select ON public.app_erros_log
  FOR SELECT TO authenticated
  USING (app_private.is_authenticated_user());

REVOKE ALL ON public.app_erros_log FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.app_erros_log FROM authenticated;

SELECT cron.schedule(
  'limpar-erros-log',
  '17 4 * * *',
  $$DELETE FROM public.app_erros_log WHERE created_at < now() - interval '90 days'$$
);
