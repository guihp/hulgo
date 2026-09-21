-- Documentos estruturados por caso + RPC para tool da IA (n8n)

CREATE TABLE IF NOT EXISTS public.documentos_cliente (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  caso_id bigint NOT NULL REFERENCES public.casos_novos(id) ON DELETE CASCADE,
  nome_documento text NOT NULL,
  descricao text,
  url_media text NOT NULL,
  mensagem_id text,
  mensagem_row_id bigint REFERENCES public.mensagens(id) ON DELETE SET NULL,
  origem text NOT NULL DEFAULT 'whatsapp',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documentos_cliente_caso_id
  ON public.documentos_cliente (caso_id);

CREATE INDEX IF NOT EXISTS idx_documentos_cliente_created_at
  ON public.documentos_cliente (created_at DESC);

-- Helpers para listas texto em casos_novos (mesmo delimitador do front)
CREATE OR REPLACE FUNCTION public.doc_list_add(p_list text, p_item text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  part text;
  norm_item text;
  result text[] := ARRAY[]::text[];
  found boolean := false;
BEGIN
  norm_item := lower(trim(coalesce(p_item, '')));
  IF norm_item = '' THEN
    RETURN coalesce(p_list, '');
  END IF;

  FOR part IN
    SELECT trim(x) FROM unnest(regexp_split_to_array(coalesce(p_list, ''), '[,;\n]+')) AS x
  LOOP
    IF part = '' THEN
      CONTINUE;
    END IF;
    IF lower(part) = norm_item THEN
      found := true;
    END IF;
    result := array_append(result, part);
  END LOOP;

  IF NOT found THEN
    result := array_append(result, trim(p_item));
  END IF;

  RETURN array_to_string(result, ', ');
END;
$$;

CREATE OR REPLACE FUNCTION public.doc_list_remove(p_list text, p_item text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  part text;
  norm_item text;
  result text[] := ARRAY[]::text[];
BEGIN
  norm_item := lower(trim(coalesce(p_item, '')));
  IF norm_item = '' THEN
    RETURN coalesce(p_list, '');
  END IF;

  FOR part IN
    SELECT trim(x) FROM unnest(regexp_split_to_array(coalesce(p_list, ''), '[,;\n]+')) AS x
  LOOP
    IF part = '' OR lower(part) = norm_item THEN
      CONTINUE;
    END IF;
    result := array_append(result, part);
  END LOOP;

  RETURN array_to_string(result, ', ');
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_documento_cliente(
  p_nome_documento text,
  p_url_media text,
  p_descricao text DEFAULT NULL,
  p_telefone text DEFAULT NULL,
  p_cpf text DEFAULT NULL,
  p_caso_id bigint DEFAULT NULL,
  p_mensagem_id text DEFAULT NULL,
  p_mensagem_row_id bigint DEFAULT NULL,
  p_origem text DEFAULT 'whatsapp'
)
RETURNS TABLE(
  documento_id bigint,
  caso_id bigint,
  documentos_recebidos text,
  documentos_faltantes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caso_id bigint;
  v_phone_norm text;
  v_cpf_norm text;
  v_doc_id bigint;
  v_recebidos text;
  v_faltantes text;
BEGIN
  IF p_nome_documento IS NULL OR trim(p_nome_documento) = '' THEN
    RAISE EXCEPTION 'nome_documento is required';
  END IF;
  IF p_url_media IS NULL OR trim(p_url_media) = '' THEN
    RAISE EXCEPTION 'url_media is required';
  END IF;

  v_phone_norm := public.normalize_phone_digits(p_telefone);
  v_cpf_norm := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');

  SELECT c.id INTO v_caso_id
  FROM public.casos_novos c
  WHERE
    (p_caso_id IS NOT NULL AND c.id = p_caso_id)
    OR (v_cpf_norm <> '' AND regexp_replace(c.cpf, '\D', '', 'g') = v_cpf_norm)
    OR (
      v_phone_norm <> ''
      AND public.normalize_phone_digits(c.telefone) = v_phone_norm
    )
  ORDER BY
    CASE WHEN c.status = 'processo_criado' THEN 1 ELSE 0 END,
    c.created_at DESC
  LIMIT 1;

  IF v_caso_id IS NULL THEN
    RAISE EXCEPTION 'Caso não encontrado para telefone/cpf informado. Registre o caso antes com registrar_caso_para_advogado.';
  END IF;

  INSERT INTO public.documentos_cliente (
    caso_id,
    nome_documento,
    descricao,
    url_media,
    mensagem_id,
    mensagem_row_id,
    origem
  ) VALUES (
    v_caso_id,
    trim(p_nome_documento),
    nullif(trim(coalesce(p_descricao, '')), ''),
    trim(p_url_media),
    nullif(trim(coalesce(p_mensagem_id, '')), ''),
    p_mensagem_row_id,
    coalesce(nullif(trim(p_origem), ''), 'whatsapp')
  )
  RETURNING id INTO v_doc_id;

  SELECT c.documentos_recebidos, c.documentos_faltantes
  INTO v_recebidos, v_faltantes
  FROM public.casos_novos c
  WHERE c.id = v_caso_id;

  v_recebidos := public.doc_list_add(v_recebidos, trim(p_nome_documento));
  v_faltantes := public.doc_list_remove(v_faltantes, trim(p_nome_documento));

  UPDATE public.casos_novos
  SET
    documentos_recebidos = v_recebidos,
    documentos_faltantes = v_faltantes,
    updated_at = now()
  WHERE id = v_caso_id;

  RETURN QUERY SELECT v_doc_id, v_caso_id, v_recebidos, v_faltantes;
END;
$$;

ALTER TABLE public.documentos_cliente ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "documentos_cliente_select_authenticated"
  ON public.documentos_cliente FOR SELECT TO authenticated
  USING (app_private.is_authenticated_user());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT ON public.documentos_cliente TO authenticated;
GRANT ALL ON public.documentos_cliente TO service_role;
GRANT EXECUTE ON FUNCTION public.doc_list_add(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.doc_list_remove(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_documento_cliente(
  text, text, text, text, text, bigint, text, bigint, text
) TO service_role;
