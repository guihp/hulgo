-- Allow document attachments in agent sandbox messages
alter table public.app_agente_sandbox_mensagens
  drop constraint if exists app_agente_sandbox_mensagens_media_kind_check;

alter table public.app_agente_sandbox_mensagens
  add constraint app_agente_sandbox_mensagens_media_kind_check
  check (media_kind is null or media_kind in ('image', 'audio', 'documento'));
