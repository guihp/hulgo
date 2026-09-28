-- Realtime para o board de processos (/processos)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'processos_clientes'
  ) then
    alter publication supabase_realtime add table public.processos_clientes;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_processo_colunas'
  ) then
    alter publication supabase_realtime add table public.app_processo_colunas;
  end if;
end $$;
