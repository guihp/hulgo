-- Tool da IA: preencher/atualizar os dados do caso durante a triagem.
-- Atualiza apenas os campos enviados (não-nulos); cria o caso se não existir.
CREATE OR REPLACE FUNCTION public.atualizar_dados_caso(
  p_telefone text,
  p_nome text DEFAULT NULL,
  p_cpf text DEFAULT NULL,
  p_data_nascimento text DEFAULT NULL, -- 'YYYY-MM-DD' ou 'DD/MM/YYYY'
  p_beneficio_identificado text DEFAULT NULL,
  p_area text DEFAULT NULL,
  p_tipo_segurado text DEFAULT NULL,
  p_ja_negou_inss boolean DEFAULT NULL,
  p_motivo_negativa text DEFAULT NULL,
  p_ja_tem_processo boolean DEFAULT NULL,
  p_ja_recebe_beneficio text DEFAULT NULL,
  p_requisitos_preenchidos text DEFAULT NULL,
  p_requisitos_pendentes text DEFAULT NULL,
  p_pontos_analise_juridica text DEFAULT NULL,
  p_beneficios_alternativos text DEFAULT NULL
)
RETURNS TABLE(caso_id bigint, status text, campos_atualizados text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_norm text;
  v_caso_id bigint;
  v_status text;
  v_nascimento date;
  v_campos text[] := ARRAY[]::text[];
BEGIN
  v_phone_norm := public.normalize_phone_digits(p_telefone);
  IF v_phone_norm = '' THEN
    RAISE EXCEPTION 'telefone inválido';
  END IF;

  -- data de nascimento: aceita YYYY-MM-DD ou DD/MM/YYYY
  IF nullif(trim(p_data_nascimento), '') IS NOT NULL THEN
    BEGIN
      IF p_data_nascimento ~ '^\d{2}/\d{2}/\d{4}$' THEN
        v_nascimento := to_date(p_data_nascimento, 'DD/MM/YYYY');
      ELSE
        v_nascimento := p_data_nascimento::date;
      END IF;
    EXCEPTION WHEN others THEN
      v_nascimento := NULL;
    END;
  END IF;

  SELECT c.id, c.status INTO v_caso_id, v_status
  FROM public.casos_novos c
  WHERE public.normalize_phone_digits(c.telefone) = v_phone_norm
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_caso_id IS NULL THEN
    INSERT INTO public.casos_novos (telefone, status)
    VALUES (v_phone_norm, 'em_atendimento')
    RETURNING id, casos_novos.status INTO v_caso_id, v_status;
  END IF;

  IF nullif(trim(p_nome), '') IS NOT NULL THEN v_campos := v_campos || 'nome'; END IF;
  IF nullif(regexp_replace(coalesce(p_cpf,''), '\D', '', 'g'), '') IS NOT NULL THEN v_campos := v_campos || 'cpf'; END IF;
  IF v_nascimento IS NOT NULL THEN v_campos := v_campos || 'data_nascimento'; END IF;
  IF nullif(trim(p_beneficio_identificado), '') IS NOT NULL THEN v_campos := v_campos || 'beneficio_identificado'; END IF;
  IF nullif(trim(p_area), '') IS NOT NULL THEN v_campos := v_campos || 'area'; END IF;
  IF nullif(trim(p_tipo_segurado), '') IS NOT NULL THEN v_campos := v_campos || 'tipo_segurado'; END IF;
  IF p_ja_negou_inss IS NOT NULL THEN v_campos := v_campos || 'ja_negou_inss'; END IF;
  IF nullif(trim(p_motivo_negativa), '') IS NOT NULL THEN v_campos := v_campos || 'motivo_negativa'; END IF;
  IF p_ja_tem_processo IS NOT NULL THEN v_campos := v_campos || 'ja_tem_processo'; END IF;
  IF nullif(trim(p_ja_recebe_beneficio), '') IS NOT NULL THEN v_campos := v_campos || 'ja_recebe_beneficio'; END IF;
  IF nullif(trim(p_requisitos_preenchidos), '') IS NOT NULL THEN v_campos := v_campos || 'requisitos_preenchidos'; END IF;
  IF nullif(trim(p_requisitos_pendentes), '') IS NOT NULL THEN v_campos := v_campos || 'requisitos_pendentes'; END IF;
  IF nullif(trim(p_pontos_analise_juridica), '') IS NOT NULL THEN v_campos := v_campos || 'pontos_analise_juridica'; END IF;
  IF nullif(trim(p_beneficios_alternativos), '') IS NOT NULL THEN v_campos := v_campos || 'beneficios_alternativos'; END IF;

  UPDATE public.casos_novos c SET
    nome = coalesce(nullif(trim(p_nome), ''), c.nome),
    cpf = coalesce(nullif(regexp_replace(coalesce(p_cpf,''), '\D', '', 'g'), ''), c.cpf),
    data_nascimento = coalesce(v_nascimento, c.data_nascimento),
    beneficio_identificado = coalesce(nullif(trim(p_beneficio_identificado), ''), c.beneficio_identificado),
    area = coalesce(nullif(trim(p_area), ''), c.area),
    tipo_segurado = coalesce(nullif(trim(p_tipo_segurado), ''), c.tipo_segurado),
    ja_negou_inss = coalesce(p_ja_negou_inss, c.ja_negou_inss),
    motivo_negativa = coalesce(nullif(trim(p_motivo_negativa), ''), c.motivo_negativa),
    ja_tem_processo = coalesce(p_ja_tem_processo, c.ja_tem_processo),
    ja_recebe_beneficio = coalesce(nullif(trim(p_ja_recebe_beneficio), ''), c.ja_recebe_beneficio),
    requisitos_preenchidos = coalesce(nullif(trim(p_requisitos_preenchidos), ''), c.requisitos_preenchidos),
    requisitos_pendentes = coalesce(nullif(trim(p_requisitos_pendentes), ''), c.requisitos_pendentes),
    pontos_analise_juridica = coalesce(nullif(trim(p_pontos_analise_juridica), ''), c.pontos_analise_juridica),
    beneficios_alternativos = coalesce(nullif(trim(p_beneficios_alternativos), ''), c.beneficios_alternativos),
    updated_at = now()
  WHERE c.id = v_caso_id;

  RETURN QUERY SELECT
    v_caso_id,
    v_status,
    CASE WHEN array_length(v_campos, 1) IS NULL
      THEN 'nenhum campo novo'
      ELSE array_to_string(v_campos, ', ')
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_dados_caso(text,text,text,text,text,text,text,boolean,text,boolean,text,text,text,text,text) TO service_role;
