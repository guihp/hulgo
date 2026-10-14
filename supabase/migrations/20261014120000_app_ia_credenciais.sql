-- Chave da OpenAI e modelos configuráveis pelo painel (Configurações → Inteligência artificial).
-- A chave fica CIFRADA (AES-256-GCM no servidor; a senha mestra é a env APP_ENCRYPTION_KEY).
-- Sem nenhuma policy: anon e authenticated não leem nem escrevem; só a service_role (servidor).
CREATE TABLE IF NOT EXISTS public.app_ia_credenciais (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  openai_key_cifrada text,
  openai_key_final text,
  modelo_chat text,
  modelo_whatsapp text,
  modelo_transcricao text,
  raciocinio_whatsapp text CHECK (raciocinio_whatsapp IN ('low', 'medium', 'high')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

COMMENT ON TABLE public.app_ia_credenciais IS
  'Credenciais/modelos da OpenAI. Chave cifrada; leitura só pela service_role.';
COMMENT ON COLUMN public.app_ia_credenciais.openai_key_final IS
  'Últimos 4 caracteres da chave, para exibir no painel.';

INSERT INTO public.app_ia_credenciais (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_ia_credenciais ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_ia_credenciais FROM anon, authenticated;
