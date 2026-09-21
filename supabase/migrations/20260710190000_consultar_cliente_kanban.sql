-- Consulta posição do cliente no funil Kanban (tool da IA)
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
