-- Kanban: coluna "Aguardando análise" + anti-duplicata da mensagem fixa de encaminhamento

-- Flag: mensagem fixa de encaminhamento já enviada (n8n ou painel)
ALTER TABLE public.casos_novos
  ADD COLUMN IF NOT EXISTS mensagem_encaminhamento_enviada_em timestamptz;

COMMENT ON COLUMN public.casos_novos.mensagem_encaminhamento_enviada_em IS
  'Quando a mensagem fixa de encaminhamento para análise foi enviada ao cliente (anti-duplicata).';

-- Ranking: aguardando_analise entre abertura_processo e aguardando_aprovacao
CREATE OR REPLACE FUNCTION public.kanban_status_rank(p_status text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'em_atendimento' THEN 1
    WHEN 'consultar_processo' THEN 2
    WHEN 'abertura_processo' THEN 3
    WHEN 'aguardando_analise' THEN 4
    WHEN 'aguardando_aprovacao' THEN 5
    WHEN 'atendimento_humano' THEN 6
    WHEN 'processo_finalizado' THEN 99
    ELSE 0
  END;
$$;

-- RPC mover: inclui aguardando_analise
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
    'aguardando_analise',
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

-- RPC consultar: label da nova coluna
CREATE OR REPLACE FUNCTION public.consultar_cliente_kanban(p_telefone text)
RETURNS TABLE(
  encontrado boolean,
  caso_id bigint,
  status text,
  coluna text,
  nome text,
  cpf text,
  beneficio_identificado text,
  documentos_recebidos text,
  documentos_faltantes text,
  telefone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_norm text;
BEGIN
  v_phone_norm := public.normalize_phone_digits(p_telefone);
  IF v_phone_norm = '' THEN
    RAISE EXCEPTION 'telefone inválido';
  END IF;

  RETURN QUERY
  SELECT
    true AS encontrado,
    c.id AS caso_id,
    c.status,
    CASE c.status
      WHEN 'em_atendimento' THEN 'Em atendimento'
      WHEN 'consultar_processo' THEN 'Consultar processo'
      WHEN 'abertura_processo' THEN 'Abertura de processo'
      WHEN 'aguardando_analise' THEN 'Aguardando análise'
      WHEN 'aguardando_aprovacao' THEN 'Aguardando aprovação'
      WHEN 'atendimento_humano' THEN 'Solicitou atendimento humano'
      WHEN 'processo_finalizado' THEN 'Processo finalizado'
      ELSE coalesce(c.status, 'Em atendimento')
    END AS coluna,
    c.nome,
    c.cpf,
    c.beneficio_identificado,
    c.documentos_recebidos,
    c.documentos_faltantes,
    v_phone_norm AS telefone
  FROM public.casos_novos c
  WHERE public.normalize_phone_digits(c.telefone) = v_phone_norm
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      NULL::bigint,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      v_phone_norm;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consultar_cliente_kanban(text) TO service_role;
