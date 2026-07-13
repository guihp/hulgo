-- Upload outbound do painel por usuários autenticados
DO $$ BEGIN
  CREATE POLICY "Authenticated upload mensagens-media outbound"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'mensagens-media'
    AND name ~ '^[0-9]+/out-'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/opus', 'audio/wav',
  'application/pdf', 'application/octet-stream',
  'video/mp4', 'video/webm', 'video/quicktime'
]
WHERE id = 'mensagens-media';
