-- Celular BR sem o nono dígito (JID antigo do WhatsApp): insere o 9.
-- + reparo dos registros existentes (aplicado via MCP em 2026-07-10).
CREATE OR REPLACE FUNCTION public.normalize_phone_digits(p_phone text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text;
BEGIN
  d := regexp_replace(split_part(coalesce(p_phone, ''), '@', 1), '[^0-9]', '', 'g');
  IF length(d) = 12 AND d LIKE '55%' AND substr(d, 5, 1) IN ('6','7','8','9') THEN
    d := substr(d, 1, 4) || '9' || substr(d, 5);
  END IF;
  RETURN d;
END; $$;
