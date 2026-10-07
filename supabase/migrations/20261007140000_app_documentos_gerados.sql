-- Documentos preenchidos (procuração, termos, autodeclarações...) gerados pelo assistente.
-- Não guarda arquivo no Storage: só os valores dos campos; o PDF é montado na hora
-- em /api/documentos/gerados/{id}. O link vale 1 dia e a linha é apagada depois.
CREATE TABLE IF NOT EXISTS public.app_documentos_gerados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 day',
  criado_por uuid REFERENCES auth.users (id) ON DELETE SET NULL DEFAULT auth.uid(),
  modelo text NOT NULL,
  cliente_nome text,
  cliente_cpf text,
  valores jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.app_documentos_gerados IS
  'Documentos preenchidos (valores dos campos) com link de 1 dia. Sem arquivo no Storage; limpeza horária via pg_cron.';

CREATE INDEX IF NOT EXISTS app_documentos_gerados_expires_idx
  ON public.app_documentos_gerados (expires_at);

ALTER TABLE public.app_documentos_gerados ENABLE ROW LEVEL SECURITY;

-- Equipe autenticada (usuário ativo do painel) lê e cria; ninguém altera.
CREATE POLICY app_documentos_gerados_select ON public.app_documentos_gerados
  FOR SELECT TO authenticated
  USING (app_private.is_authenticated_user() AND expires_at > now());

CREATE POLICY app_documentos_gerados_insert ON public.app_documentos_gerados
  FOR INSERT TO authenticated
  WITH CHECK (app_private.is_authenticated_user() AND criado_por = auth.uid());

REVOKE ALL ON public.app_documentos_gerados FROM anon;

-- Limpeza: de hora em hora remove os expirados.
SELECT cron.schedule(
  'limpar-documentos-gerados',
  '7 * * * *',
  $$DELETE FROM public.app_documentos_gerados WHERE expires_at < now()$$
);
