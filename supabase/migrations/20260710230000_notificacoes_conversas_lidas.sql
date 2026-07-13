-- Controle de leitura por usuário (badge estilo WhatsApp)
create table if not exists public.app_conversas_lidas (
  user_id      uuid not null references auth.users (id) on delete cascade,
  contact_norm text not null,
  lida_em      timestamptz not null default now(),
  primary key (user_id, contact_norm)
);

alter table public.app_conversas_lidas enable row level security;

drop policy if exists "conversas_lidas_all" on public.app_conversas_lidas;
create policy "conversas_lidas_all" on public.app_conversas_lidas
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Realtime: eventos que alimentam as notificações do painel
do $$ begin
  alter publication supabase_realtime add table public.mensagens;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.documentos_cliente;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.casos_novos;
exception when duplicate_object then null; end $$;

-- Necessário para o realtime entregar o valor ANTIGO no UPDATE
-- (detecção de mudança de coluna no Kanban)
alter table public.casos_novos replica identity full;
