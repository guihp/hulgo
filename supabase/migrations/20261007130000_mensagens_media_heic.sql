-- Fotos de iPhone (HEIC/HEIF) e BMP no bucket de mídia.
-- O painel converte para JPEG no navegador quando consegue; isto cobre o "Só salvar" sem conversão.
UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT array_agg(DISTINCT m)
  FROM unnest(allowed_mime_types || ARRAY['image/heic', 'image/heif', 'image/bmp', 'image/jpg']) AS m
)
WHERE id = 'mensagens-media';
