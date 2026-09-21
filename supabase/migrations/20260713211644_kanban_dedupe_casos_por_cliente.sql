-- Kanban: 1 cliente = 1 caso. Normaliza status legado do n8n, funde linhas
-- duplicadas por telefone e libera INSERT em aprovacoes_pendentes pelo painel.
-- (Já aplicada no projeto remoto via MCP em 2026-07-13.)

-- 1) Normaliza status legado do n8n para as colunas do Kanban
-- aguardando_advogado = "cliente passou os dados, falta criar o processo" -> abertura_processo
UPDATE public.casos_novos
SET status = 'abertura_processo'
WHERE status IN ('aguardando_advogado', 'em_analise');

UPDATE public.casos_novos
SET status = 'processo_finalizado'
WHERE status IN ('processo_criado', 'arquivado');

UPDATE public.casos_novos
SET status = 'em_atendimento'
WHERE status IS NULL OR public.kanban_status_rank(status) = 0;

-- 2) Dedupe: 1 cliente (telefone) = 1 caso. Mantém a linha de status mais
-- avançado (empate: mais recente), funde campos e repontea FKs.
DO $$
DECLARE
  grp RECORD;
  keep_id bigint;
  dup_id bigint;
BEGIN
  FOR grp IN
    SELECT
      public.normalize_phone_digits(telefone) AS tel,
      array_agg(id ORDER BY public.kanban_status_rank(status) DESC, created_at DESC) AS ids
    FROM public.casos_novos
    WHERE public.normalize_phone_digits(telefone) <> ''
    GROUP BY 1
    HAVING count(*) > 1
  LOOP
    keep_id := grp.ids[1];

    FOREACH dup_id IN ARRAY grp.ids[2:] LOOP
      UPDATE public.documentos_cliente SET caso_id = keep_id WHERE caso_id = dup_id;
      UPDATE public.app_notas_caso SET caso_id = keep_id WHERE caso_id = dup_id;
      UPDATE public.app_prazos SET caso_id = keep_id WHERE caso_id = dup_id;

      UPDATE public.casos_novos k
      SET
        nome = COALESCE(k.nome, d.nome),
        cpf = COALESCE(k.cpf, d.cpf),
        data_nascimento = COALESCE(k.data_nascimento, d.data_nascimento),
        beneficio_identificado = COALESCE(k.beneficio_identificado, d.beneficio_identificado),
        area = COALESCE(k.area, d.area),
        tipo_segurado = COALESCE(k.tipo_segurado, d.tipo_segurado),
        ja_negou_inss = COALESCE(k.ja_negou_inss, d.ja_negou_inss),
        motivo_negativa = COALESCE(k.motivo_negativa, d.motivo_negativa),
        ja_tem_processo = COALESCE(k.ja_tem_processo, d.ja_tem_processo),
        ja_recebe_beneficio = COALESCE(k.ja_recebe_beneficio, d.ja_recebe_beneficio),
        requisitos_preenchidos = COALESCE(k.requisitos_preenchidos, d.requisitos_preenchidos),
        requisitos_pendentes = COALESCE(k.requisitos_pendentes, d.requisitos_pendentes),
        documentos_recebidos = CASE
          WHEN COALESCE(k.documentos_recebidos, '') = '' THEN d.documentos_recebidos
          ELSE k.documentos_recebidos END,
        documentos_faltantes = CASE
          WHEN COALESCE(k.documentos_faltantes, '') = '' THEN d.documentos_faltantes
          ELSE k.documentos_faltantes END,
        pontos_analise_juridica = COALESCE(k.pontos_analise_juridica, d.pontos_analise_juridica),
        beneficios_alternativos = COALESCE(k.beneficios_alternativos, d.beneficios_alternativos),
        relatorio = COALESCE(k.relatorio, d.relatorio),
        consulta_tse = COALESCE(NULLIF(k.consulta_tse, ''), d.consulta_tse),
        consulta_dap_caf = COALESCE(NULLIF(k.consulta_dap_caf, ''), d.consulta_dap_caf),
        consulta_jf = COALESCE(NULLIF(k.consulta_jf, ''), d.consulta_jf),
        updated_at = now()
      FROM public.casos_novos d
      WHERE k.id = keep_id AND d.id = dup_id;

      DELETE FROM public.casos_novos WHERE id = dup_id;
    END LOOP;
  END LOOP;
END;
$$;

-- 3) Painel (authenticated) pode criar pendência de aprovação ao mover o
-- card para "Aguardando aprovação"
DROP POLICY IF EXISTS aprovacoes_insert ON public.aprovacoes_pendentes;
CREATE POLICY aprovacoes_insert ON public.aprovacoes_pendentes
  FOR INSERT TO authenticated
  WITH CHECK (true);
