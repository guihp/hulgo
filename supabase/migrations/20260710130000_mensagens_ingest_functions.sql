-- normalize_phone_digits, resolve_mensagens_contact_norm, upsert_mensagem
-- Updated trigger + app_conversas_resumo view + mensagens-media storage bucket

-- 1. Phone normalization helpers
CREATE OR REPLACE FUNCTION public.normalize_phone_digits(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(split_part(coalesce(p_phone, ''), '@', 1), '[^0-9]', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.resolve_mensagens_contact_norm(p_phone text, p_plataforma text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(trim(coalesce(p_plataforma, 'whatsapp'))) = 'whatsapp' THEN
      public.normalize_phone_digits(p_phone)
    ELSE
      lower(trim(coalesce(p_phone, '')))
  END;
$$;

-- 2. Idempotent upsert for n8n ingest
CREATE OR REPLACE FUNCTION public.upsert_mensagem(
  p_phone text,
  p_type text,
  p_text text DEFAULT NULL,
  p_mensagem_id text DEFAULT NULL,
  p_mensage_type text DEFAULT NULL,
  p_plataforma text DEFAULT 'whatsapp',
  p_instancia text DEFAULT NULL,
  p_session_id text DEFAULT NULL,
  p_conteudo_media text DEFAULT NULL
)
RETURNS TABLE(result_id bigint, result_contact_norm text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_norm text;
  v_id bigint;
BEGIN
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RAISE EXCEPTION 'phone is required';
  END IF;
  IF p_type IS NULL OR trim(p_type) = '' THEN
    RAISE EXCEPTION 'type is required';
  END IF;

  v_contact_norm := public.resolve_mensagens_contact_norm(p_phone, p_plataforma);

  IF p_mensagem_id IS NOT NULL AND trim(p_mensagem_id) <> '' THEN
    INSERT INTO public.mensagens (
      phone,
      contact_norm,
      type,
      text,
      mensagem_id,
      mensage_type,
      plataforma,
      instancia,
      session_id,
      conteudo_media
    ) VALUES (
      v_contact_norm,
      v_contact_norm,
      p_type,
      p_text,
      trim(p_mensagem_id),
      p_mensage_type,
      lower(trim(coalesce(p_plataforma, 'whatsapp'))),
      p_instancia,
      p_session_id,
      p_conteudo_media
    )
    ON CONFLICT (mensagem_id) WHERE ((mensagem_id IS NOT NULL) AND (TRIM(BOTH FROM mensagem_id) <> ''::text))
    DO UPDATE SET
      phone = COALESCE(EXCLUDED.phone, mensagens.phone),
      contact_norm = COALESCE(EXCLUDED.contact_norm, mensagens.contact_norm),
      type = COALESCE(EXCLUDED.type, mensagens.type),
      text = COALESCE(EXCLUDED.text, mensagens.text),
      mensage_type = COALESCE(EXCLUDED.mensage_type, mensagens.mensage_type),
      plataforma = COALESCE(EXCLUDED.plataforma, mensagens.plataforma),
      instancia = COALESCE(EXCLUDED.instancia, mensagens.instancia),
      session_id = COALESCE(EXCLUDED.session_id, mensagens.session_id),
      conteudo_media = COALESCE(EXCLUDED.conteudo_media, mensagens.conteudo_media)
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.mensagens (
      phone,
      type,
      text,
      mensagem_id,
      mensage_type,
      plataforma,
      instancia,
      session_id,
      conteudo_media
    ) VALUES (
      v_contact_norm,
      p_type,
      p_text,
      p_mensagem_id,
      p_mensage_type,
      lower(trim(coalesce(p_plataforma, 'whatsapp'))),
      p_instancia,
      p_session_id,
      p_conteudo_media
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN QUERY SELECT v_id, v_contact_norm;
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_phone_digits(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_mensagens_contact_norm(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_mensagem(text, text, text, text, text, text, text, text, text) TO service_role;

-- 3. Updated before-save trigger
CREATE OR REPLACE FUNCTION public.trg_mensagens_before_save()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.plataforma := lower(trim(coalesce(NEW.plataforma, 'whatsapp')));
  NEW.contact_norm := public.resolve_mensagens_contact_norm(NEW.phone, NEW.plataforma);
  IF NEW.contact_norm IS NOT NULL AND NEW.contact_norm <> '' THEN
    NEW.phone := NEW.contact_norm;
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Conversation summary view for list queries
CREATE OR REPLACE VIEW public.app_conversas_resumo AS
SELECT DISTINCT ON (contact_norm)
  contact_norm,
  phone,
  text AS last_message,
  type AS last_type,
  mensage_type AS last_mensage_type,
  conteudo_media AS last_conteudo_media,
  created_at AS last_at
FROM public.mensagens
WHERE contact_norm IS NOT NULL AND contact_norm <> ''
ORDER BY contact_norm, created_at DESC;

GRANT SELECT ON public.app_conversas_resumo TO authenticated;

-- 5. Storage bucket for media uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mensagens-media',
  'mensagens-media',
  true,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'application/pdf', 'video/mp4']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Service role can upload; public read for media URLs
DO $$ BEGIN
  CREATE POLICY "Service role upload mensagens-media"
  ON storage.objects FOR INSERT TO service_role
  WITH CHECK (bucket_id = 'mensagens-media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role update mensagens-media"
  ON storage.objects FOR UPDATE TO service_role
  USING (bucket_id = 'mensagens-media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Public read mensagens-media"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'mensagens-media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated read mensagens-media"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'mensagens-media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
