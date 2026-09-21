-- Database Webhooks → Coolify POST /api/push/webhook
-- Payload shape matches Supabase Database Webhooks (type/table/schema/record/old_record)
-- consumed by app/api/push/webhook/route.ts
--
-- URL de produção: https://advocacia.iafeoficial.com/api/push/webhook
-- Secret header: x-push-webhook-secret = PUSH_WEBHOOK_SECRET

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_painel_push_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  webhook_url text := 'https://advocacia.iafeoficial.com/api/push/webhook';
  webhook_secret text := '8ba368f9fe57eb473005e85252c8817686d57eeaa0602c75b844304a7634264f';
  payload jsonb;
  request_id bigint;
begin

  payload := jsonb_build_object(
    'type', tg_op,
    'table', tg_table_name,
    'schema', tg_table_schema,
    'record', case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    'old_record', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end
  );

  select net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-webhook-secret', webhook_secret
    ),
    body := payload,
    timeout_milliseconds := 5000
  ) into request_id;

  return coalesce(new, old);
end;
$$;

comment on function public.notify_painel_push_webhook() is
  'Dispara Web Push via POST /api/push/webhook (equivalente a Database Webhooks do Dashboard)';

drop trigger if exists push_webhook_mensagens_insert on public.mensagens;
create trigger push_webhook_mensagens_insert
  after insert on public.mensagens
  for each row
  execute function public.notify_painel_push_webhook();

drop trigger if exists push_webhook_casos_novos_ins_upd on public.casos_novos;
create trigger push_webhook_casos_novos_ins_upd
  after insert or update on public.casos_novos
  for each row
  execute function public.notify_painel_push_webhook();

drop trigger if exists push_webhook_documentos_cliente_insert on public.documentos_cliente;
create trigger push_webhook_documentos_cliente_insert
  after insert on public.documentos_cliente
  for each row
  execute function public.notify_painel_push_webhook();

drop trigger if exists push_webhook_aprovacoes_pendentes_insert on public.aprovacoes_pendentes;
create trigger push_webhook_aprovacoes_pendentes_insert
  after insert on public.aprovacoes_pendentes
  for each row
  execute function public.notify_painel_push_webhook();

drop trigger if exists push_webhook_app_prazos_insert on public.app_prazos;
create trigger push_webhook_app_prazos_insert
  after insert on public.app_prazos
  for each row
  execute function public.notify_painel_push_webhook();
