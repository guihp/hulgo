ALTER TABLE public.app_ia_estado ADD COLUMN IF NOT EXISTS nome_contato text;
COMMENT ON COLUMN public.app_ia_estado.nome_contato IS 'PushName do WhatsApp (última mensagem recebida).';
