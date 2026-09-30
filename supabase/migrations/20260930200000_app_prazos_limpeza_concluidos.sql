-- Limpeza automática de prazos/audiências concluídos há mais de 30 dias.
-- FKs de app_prazos_lembretes e app_prazos_alertas já são ON DELETE CASCADE.

update public.app_prazos
   set concluido_em = now()
 where concluido
   and concluido_em is null;

create or replace function public.limpar_prazos_concluidos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.app_prazos
   where concluido
     and concluido_em < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.limpar_prazos_concluidos() from public, anon, authenticated;
grant execute on function public.limpar_prazos_concluidos() to service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'limpar-prazos-concluidos') then
    perform cron.unschedule('limpar-prazos-concluidos');
  end if;
  -- 06:00 UTC = 03:00 Brasília
  perform cron.schedule(
    'limpar-prazos-concluidos',
    '0 6 * * *',
    'select public.limpar_prazos_concluidos()'
  );
end;
$$;
