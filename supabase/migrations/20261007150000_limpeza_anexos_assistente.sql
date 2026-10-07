-- Anexos do assistente interno (fotos de RG, comprovantes...) em
-- mensagens-media/assistente/** são apagados 1 dia depois do envio,
-- EXCETO os que foram salvos na ficha de um cliente (documentos_cliente.url_media).
--
-- Fluxo: pg_cron (de hora em hora) → pg_net → Edge Function limpar-anexos-assistente
-- → Storage API (apagar só a linha de storage.objects deixaria o arquivo ocupando espaço).
-- A chave do cron fica no Vault (criptografada, fora do Git).

SELECT vault.create_secret(
  encode(extensions.gen_random_bytes(24), 'hex'),
  'limpeza_anexos_chave',
  'Chave do cron que chama a Edge Function limpar-anexos-assistente'
)
WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'limpeza_anexos_chave');

-- Lista o que pode ser apagado. Só service_role executa, e só com a chave certa.
CREATE OR REPLACE FUNCTION public.anexos_assistente_expirados(
  p_chave text,
  p_limite integer DEFAULT 500
)
RETURNS TABLE (name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_chave IS NULL OR p_chave IS DISTINCT FROM (
    SELECT s.decrypted_secret FROM vault.decrypted_secrets s
    WHERE s.name = 'limpeza_anexos_chave'
  ) THEN
    RAISE EXCEPTION 'chave inválida' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT o.name
  FROM storage.objects o
  WHERE o.bucket_id = 'mensagens-media'
    AND o.name LIKE 'assistente/%'
    AND o.created_at < now() - interval '1 day'
    AND NOT EXISTS (
      SELECT 1 FROM public.documentos_cliente d
      WHERE d.url_media LIKE '%/mensagens-media/' || o.name
    )
  ORDER BY o.created_at
  LIMIT greatest(1, least(p_limite, 1000));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.anexos_assistente_expirados(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anexos_assistente_expirados(text, integer) TO service_role;

SELECT cron.schedule(
  'limpar-anexos-assistente',
  '17 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hzfvciamevimjzuvidcp.supabase.co/functions/v1/limpar-anexos-assistente',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'limpeza_anexos_chave')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
