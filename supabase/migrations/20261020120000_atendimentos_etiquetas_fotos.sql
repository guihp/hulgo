-- Atendimentos estilo WhatsApp: etiquetas, foto de perfil, "marcar como não lida"
-- e lista de conversas calculada no banco (sem o limite de 500 mensagens).

-- Foto de perfil e JID real do WhatsApp (sem o 9º dígito em vários DDDs).
ALTER TABLE public.app_ia_estado
  ADD COLUMN IF NOT EXISTS foto_url text,
  ADD COLUMN IF NOT EXISTS foto_verificada_em timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_jid text;
COMMENT ON COLUMN public.app_ia_estado.foto_url IS 'Foto de perfil copiada para o bucket mensagens-media (avatars/). Null = sem foto ou privada.';
COMMENT ON COLUMN public.app_ia_estado.foto_verificada_em IS 'Última consulta da foto na EvoGo (refeita a cada 7 dias).';
COMMENT ON COLUMN public.app_ia_estado.whatsapp_jid IS 'JID @s.whatsapp.net do contato, como chegou no webhook.';

-- "Marcar como não lida" (por usuário).
ALTER TABLE public.app_conversas_lidas
  ADD COLUMN IF NOT EXISTS nao_lida boolean NOT NULL DEFAULT false;

-- Etiquetas (compartilhadas pelo escritório, como no WhatsApp Business).
CREATE TABLE IF NOT EXISTS public.app_etiquetas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome text NOT NULL,
  cor text NOT NULL DEFAULT 'azul',
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_etiquetas_nome_key UNIQUE (nome)
);

CREATE TABLE IF NOT EXISTS public.app_conversa_etiquetas (
  contact_norm text NOT NULL,
  etiqueta_id bigint NOT NULL REFERENCES public.app_etiquetas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_norm, etiqueta_id)
);
CREATE INDEX IF NOT EXISTS idx_conversa_etiquetas_etiqueta ON public.app_conversa_etiquetas (etiqueta_id);

ALTER TABLE public.app_etiquetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_conversa_etiquetas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_etiquetas_all ON public.app_etiquetas;
CREATE POLICY app_etiquetas_all ON public.app_etiquetas
  FOR ALL TO authenticated
  USING (app_private.is_authenticated_user())
  WITH CHECK (app_private.is_authenticated_user());

DROP POLICY IF EXISTS app_conversa_etiquetas_all ON public.app_conversa_etiquetas;
CREATE POLICY app_conversa_etiquetas_all ON public.app_conversa_etiquetas
  FOR ALL TO authenticated
  USING (app_private.is_authenticated_user())
  WITH CHECK (app_private.is_authenticated_user());

INSERT INTO public.app_etiquetas (nome, cor, ordem) VALUES
  ('Novo contato', 'azul', 1),
  ('Aguardando documentos', 'amarelo', 2),
  ('Retornar', 'laranja', 3),
  ('Urgente', 'vermelho', 4),
  ('Cliente fechado', 'verde', 5)
ON CONFLICT (nome) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'app_etiquetas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_etiquetas;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'app_conversa_etiquetas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_conversa_etiquetas;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mensagens_contact_created
  ON public.mensagens (contact_norm, created_at DESC);

-- Uma linha por conversa: última mensagem, não lidas do usuário atual,
-- estado da IA, foto e etiquetas. SECURITY INVOKER: respeita o RLS de cada tabela.
CREATE OR REPLACE FUNCTION public.listar_conversas(p_limite integer DEFAULT 1000)
RETURNS TABLE (
  contact_norm text,
  phone text,
  ultima_em timestamptz,
  ultima_tipo text,
  ultima_texto text,
  ultima_media text,
  ultima_mensage_type text,
  nao_lidas integer,
  marcada_nao_lida boolean,
  lida_em timestamptz,
  ia_pausada boolean,
  nome_whatsapp text,
  foto_url text,
  etiquetas bigint[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ult AS (
    SELECT DISTINCT ON (m.contact_norm)
      m.contact_norm, m.phone, m.created_at, m.type, m.text, m.conteudo_media, m.mensage_type
    FROM mensagens m
    WHERE m.contact_norm IS NOT NULL AND m.contact_norm <> ''
    ORDER BY m.contact_norm, m.created_at DESC
  ),
  top AS (
    SELECT * FROM ult ORDER BY created_at DESC LIMIT greatest(p_limite, 1)
  )
  SELECT
    t.contact_norm,
    t.phone,
    t.created_at,
    t.type,
    t.text,
    t.conteudo_media,
    t.mensage_type,
    (
      SELECT count(*)::int FROM mensagens m2
      WHERE m2.contact_norm = t.contact_norm
        AND m2.type IN ('lead', 'human')
        -- A equipe responder (painel ou celular) conta como leitura, como no WhatsApp.
        -- Resposta da IA (session_id = 'ia') não conta.
        AND m2.created_at > greatest(
          coalesce(l.lida_em, '-infinity'::timestamptz),
          coalesce((
            SELECT max(m3.created_at) FROM mensagens m3
            WHERE m3.contact_norm = t.contact_norm
              AND m3.type NOT IN ('lead', 'human')
              AND coalesce(m3.session_id, '') <> 'ia'
          ), '-infinity'::timestamptz)
        )
    ),
    coalesce(l.nao_lida, false),
    l.lida_em,
    coalesce(e.pausada, false),
    e.nome_contato,
    e.foto_url,
    coalesce(
      (SELECT array_agg(ce.etiqueta_id ORDER BY ce.etiqueta_id)
         FROM app_conversa_etiquetas ce WHERE ce.contact_norm = t.contact_norm),
      '{}'::bigint[]
    )
  FROM top t
  LEFT JOIN app_conversas_lidas l ON l.contact_norm = t.contact_norm AND l.user_id = auth.uid()
  LEFT JOIN app_ia_estado e ON e.telefone = t.contact_norm
  ORDER BY t.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.listar_conversas(integer) TO authenticated;
