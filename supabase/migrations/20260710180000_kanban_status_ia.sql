-- Kanban: 6 colunas alinhadas ao funil WhatsApp + sync dados_cliente_testehulgo

-- Migra status antigos para os novos valores
UPDATE public.casos_novos SET status = 'em_atendimento' WHERE status = 'aguardando_advogado';
UPDATE public.casos_novos SET status = 'abertura_processo' WHERE status = 'em_analise';
UPDATE public.casos_novos SET status = 'processo_finalizado' WHERE status IN ('processo_criado', 'arquivado');

-- Ranking para evitar regressão de coluna no sync automático
CREATE OR REPLACE FUNCTION public.kanban_status_rank(p_status text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'em_atendimento' THEN 1
    WHEN 'consultar_processo' THEN 2
    WHEN 'abertura_processo' THEN 3
    WHEN 'aguardando_aprovacao' THEN 4
    WHEN 'atendimento_humano' THEN 5
    WHEN 'processo_finalizado' THEN 99
    ELSE 0
  END;
$$;

-- RPC: mover cliente no funil (chamada pela IA via API)
CREATE OR REPLACE FUNCTION public.mover_cliente_kanban(
  p_telefone text,
  p_status text,
  p_motivo text DEFAULT NULL,
  p_nome_cliente text DEFAULT NULL
)
RETURNS TABLE(caso_id bigint, status text, telefone text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_norm text;
  v_caso_id bigint;
  v_allowed text[] := ARRAY[
    'em_atendimento',
    'consultar_processo',
    'abertura_processo',
    'aguardando_aprovacao',
    'atendimento_humano',
    'processo_finalizado'
  ];
BEGIN
  v_phone_norm := public.normalize_phone_digits(p_telefone);
  IF v_phone_norm = '' THEN
    RAISE EXCEPTION 'telefone inválido';
  END IF;
  IF NOT (p_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'status inválido: %', p_status;
  END IF;

  SELECT c.id INTO v_caso_id
  FROM public.casos_novos c
  WHERE public.normalize_phone_digits(c.telefone) = v_phone_norm
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_caso_id IS NULL THEN
    INSERT INTO public.casos_novos (
      telefone,
      nome,
      status,
      documentos_recebidos,
      documentos_faltantes
    ) VALUES (
      v_phone_norm,
      nullif(trim(coalesce(p_nome_cliente, '')), ''),
      p_status,
      '',
      ''
    )
    RETURNING id INTO v_caso_id;
  ELSE
    UPDATE public.casos_novos
    SET
      status = p_status,
      nome = COALESCE(nullif(trim(coalesce(p_nome_cliente, '')), ''), nome),
      updated_at = now()
    WHERE id = v_caso_id;
  END IF;

  INSERT INTO public.app_log_eventos (entidade, entidade_id, acao, payload)
  VALUES (
    'casos_novos',
    v_caso_id,
    'kanban_mover',
    jsonb_build_object(
      'status', p_status,
      'telefone', v_phone_norm,
      'motivo', p_motivo
    )
  );

  RETURN QUERY SELECT v_caso_id, p_status, v_phone_norm;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mover_cliente_kanban(text, text, text, text) TO service_role;

-- Trigger: dados_cliente_testehulgo → casos_novos (em_atendimento, sem regressão)
CREATE OR REPLACE FUNCTION public.sync_caso_from_dados_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_norm text;
  v_existing_status text;
  v_existing_rank int;
BEGIN
  v_phone_norm := public.normalize_phone_digits(NEW.telefone);
  IF v_phone_norm = '' THEN
    RETURN NEW;
  END IF;

  SELECT c.status INTO v_existing_status
  FROM public.casos_novos c
  WHERE public.normalize_phone_digits(c.telefone) = v_phone_norm
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_existing_status IS NULL THEN
    INSERT INTO public.casos_novos (
      telefone,
      nome,
      status,
      documentos_recebidos,
      documentos_faltantes
    ) VALUES (
      v_phone_norm,
      nullif(trim(coalesce(NEW.nome, '')), ''),
      'em_atendimento',
      '',
      ''
    );
  ELSE
    v_existing_rank := public.kanban_status_rank(v_existing_status);
    UPDATE public.casos_novos
    SET
      nome = COALESCE(nullif(trim(coalesce(NEW.nome, '')), ''), nome),
      status = CASE
        WHEN v_existing_rank > public.kanban_status_rank('em_atendimento') THEN status
        ELSE 'em_atendimento'
      END,
      updated_at = now()
    WHERE public.normalize_phone_digits(telefone) = v_phone_norm;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_caso_dados_cliente ON public.dados_cliente_testehulgo;

CREATE TRIGGER trg_sync_caso_dados_cliente
AFTER INSERT OR UPDATE ON public.dados_cliente_testehulgo
FOR EACH ROW
EXECUTE FUNCTION public.sync_caso_from_dados_cliente();

-- Atualiza registrar_documento_cliente: default em_atendimento + ordenação
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
    CASE WHEN c.status = 'processo_finalizado' THEN 1 ELSE 0 END,
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
      'em_atendimento',
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

-- Backfill: cliente existente em dados_cliente_testehulgo
INSERT INTO public.casos_novos (
  telefone,
  nome,
  status,
  documentos_recebidos,
  documentos_faltantes
)
SELECT
  public.normalize_phone_digits(d.telefone),
  nullif(trim(coalesce(d.nome, '')), ''),
  'em_atendimento',
  '',
  ''
FROM public.dados_cliente_testehulgo d
WHERE public.normalize_phone_digits(d.telefone) = '5519981941604'
  AND NOT EXISTS (
    SELECT 1
    FROM public.casos_novos c
    WHERE public.normalize_phone_digits(c.telefone) = '5519981941604'
  );
