-- Configuração central do sistema (instância WhatsApp, token n8n, etc.)
CREATE TABLE IF NOT EXISTS public.app_config (
  chave text PRIMARY KEY,
  valor text NOT NULL DEFAULT '',
  descricao text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "app_config_select_authenticated"
  ON public.app_config FOR SELECT TO authenticated
  USING (app_private.is_authenticated_user());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "app_config_update_advogado"
  ON public.app_config FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_usuarios u
      WHERE u.id = auth.uid() AND u.ativo = true AND u.papel = 'advogado'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_usuarios u
      WHERE u.id = auth.uid() AND u.ativo = true AND u.papel = 'advogado'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT ON public.app_config TO authenticated;
GRANT ALL ON public.app_config TO service_role;

INSERT INTO public.app_config (chave, valor, descricao) VALUES
  (
    'whatsapp_instancia',
    COALESCE(
      (SELECT instancia FROM public.mensagens WHERE instancia IS NOT NULL AND trim(instancia) <> '' ORDER BY created_at DESC LIMIT 1),
      'testehulgo'
    ),
    'Nome da instância Evolution/EvoGo usada no WhatsApp'
  ),
  (
    'escritorio_nome',
    'Boueres e Fonteles Advogados',
    'Nome do escritório exibido no painel'
  ),
  (
    'n8n_integracao_token',
    encode(gen_random_bytes(32), 'hex'),
    'Token para o n8n chamar as APIs de integração do painel (header x-integracao-token)'
  )
ON CONFLICT (chave) DO NOTHING;

-- Remove dados fictícios de demonstração
DELETE FROM public.mensagens
WHERE contact_norm IN (
  '5599111112222',
  '5599222223333',
  '5599333334444',
  '5599444445555',
  '5599555556666'
);

DELETE FROM public.casos_novos
WHERE nome LIKE '[TESTE]%';

-- Garante instancia nas mensagens reais a partir da config
UPDATE public.mensagens m
SET instancia = c.valor
FROM public.app_config c
WHERE c.chave = 'whatsapp_instancia'
  AND (m.instancia IS NULL OR trim(m.instancia) = '');
