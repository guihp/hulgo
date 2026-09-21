-- Pending attachment on assistant session (survives follow-up turns until anexado/cleared)

alter table public.app_assistente_sessoes
  add column if not exists pending_anexo jsonb null;

comment on column public.app_assistente_sessoes.pending_anexo is
  'Anexo pendente da sessão: {url_media, mime, nome_arquivo, modo, kind}. Null quando não há.';
