-- v_campos || 'cpf' falhava ("malformed array literal") — o literal era lido como text[].
-- A ficha do caso não era preenchida pela tool atualizar_dados_caso.
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.atualizar_dados_caso'::regproc);
  d := regexp_replace(d, 'v_campos := v_campos \|\| ''([a-z_]+)'';', 'v_campos := array_append(v_campos, ''\1'');', 'g');
  EXECUTE d;
END
$do$;
