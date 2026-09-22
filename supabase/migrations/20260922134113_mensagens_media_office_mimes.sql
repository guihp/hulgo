-- Allow Office / text document MIME types on mensagens-media (ficha + assistente uploads).
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  -- images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  -- audio
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/opus', 'audio/wav',
  -- video
  'video/mp4', 'video/webm', 'video/quicktime',
  -- generic / pdf
  'application/pdf', 'application/octet-stream',
  -- text
  'text/plain', 'text/csv', 'text/html', 'text/markdown', 'application/json', 'application/rtf',
  -- Word
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  -- Excel
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  -- PowerPoint
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  -- OpenDocument
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation'
]
WHERE id = 'mensagens-media';
