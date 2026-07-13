-- Auto-cria caso em triagem quando documento chega antes de registrar_caso_para_advogado
CREATE OR REPLACE FUNCTION public.registrar_documento_cliente(
  p_nome_documento text,
  p_url_media text,
  p_descricao text DEFAULT NULL,
  p_telefone text DEFAULT NULL,
  p_cpf text DEFAULT NULL,
  p_caso_id bigint DEFAULT NULL,
  p_mensagem_id text DEFAULT NULL,
  p_mensagem_row_id bigint DEFAULT NULL,
  p_origem text DEFAULT 'whatsapp',
  p_nome_cliente text DEFAULT NULL
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
    IF v_phone_norm = '' AND v_cpf_norm = '' AND p_caso_id IS NULL THEN
      RAISE EXCEPTION 'Informe telefone, cpf ou caso_id para vincular o documento';
    END IF;

    INSERT INTO public.casos_novos (
      telefone,
      cpf,
      nome,
      status,
      documentos_recebidos,
      documentos_faltantes
    ) VALUES (
      nullif(v_phone_norm, ''),
      nullif(v_cpf_norm, ''),
      nullif(trim(coalesce(p_nome_cliente, '')), ''),
      'aguardando_advogado',
      '',
      ''
    )
    RETURNING id INTO v_caso_id;
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
    cpf = COALESCE(nullif(v_cpf_norm, ''), cpf),
    nome = COALESCE(nullif(trim(coalesce(p_nome_cliente, '')), ''), nome),
    updated_at = now()
  WHERE id = v_caso_id;

  RETURN QUERY SELECT v_doc_id, v_caso_id, v_recebidos, v_faltantes;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_documento_cliente(
  text, text, text, text, text, bigint, text, bigint, text, text
) TO service_role;
