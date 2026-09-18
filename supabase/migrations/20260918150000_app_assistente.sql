-- Assistente interno do painel (copiloto da equipe)
-- Sessões/mensagens por usuário + auditoria básica de tools

create table if not exists public.app_assistente_sessoes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists app_assistente_sessoes_user_idx
  on public.app_assistente_sessoes (user_id);
create index if not exists app_assistente_sessoes_updated_idx
  on public.app_assistente_sessoes (updated_at desc);

comment on table public.app_assistente_sessoes is
  'Sessões do assistente interno do painel (por usuário autenticado)';

create table if not exists public.app_assistente_mensagens (
  id          uuid primary key default gen_random_uuid(),
  sessao_id   uuid not null references public.app_assistente_sessoes (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content     text not null default '',
  tool_trace  jsonb not null default '[]'::jsonb,
  anexos      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists app_assistente_mensagens_sessao_idx
  on public.app_assistente_mensagens (sessao_id, created_at);

comment on table public.app_assistente_mensagens is
  'Mensagens do assistente interno (user/assistant + tool_trace)';

create table if not exists public.app_assistente_auditoria (
  id            uuid primary key default gen_random_uuid(),
  sessao_id     uuid references public.app_assistente_sessoes (id) on delete set null,
  user_id       uuid not null references auth.users (id) on delete cascade,
  tool          text not null,
  args          jsonb not null default '{}'::jsonb,
  result        jsonb not null default '{}'::jsonb,
  confirmed_by  uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists app_assistente_auditoria_user_idx
  on public.app_assistente_auditoria (user_id, created_at desc);
create index if not exists app_assistente_auditoria_sessao_idx
  on public.app_assistente_auditoria (sessao_id);
create index if not exists app_assistente_auditoria_tool_idx
  on public.app_assistente_auditoria (tool);

comment on table public.app_assistente_auditoria is
  'Trilha de auditoria de tools do assistente interno';

alter table public.app_assistente_sessoes enable row level security;
alter table public.app_assistente_mensagens enable row level security;
alter table public.app_assistente_auditoria enable row level security;

-- Sessões: próprio usuário (qualquer papel ativo em app_usuarios)
drop policy if exists "assistente_sessoes_select_own" on public.app_assistente_sessoes;
create policy "assistente_sessoes_select_own" on public.app_assistente_sessoes
  for select to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true
    )
  );

drop policy if exists "assistente_sessoes_insert_own" on public.app_assistente_sessoes;
create policy "assistente_sessoes_insert_own" on public.app_assistente_sessoes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true
    )
  );

drop policy if exists "assistente_sessoes_update_own" on public.app_assistente_sessoes;
create policy "assistente_sessoes_update_own" on public.app_assistente_sessoes
  for update to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true
    )
  );

drop policy if exists "assistente_sessoes_delete_own" on public.app_assistente_sessoes;
create policy "assistente_sessoes_delete_own" on public.app_assistente_sessoes
  for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true
    )
  );

-- Mensagens: via sessão do dono
drop policy if exists "assistente_mensagens_select_own" on public.app_assistente_mensagens;
create policy "assistente_mensagens_select_own" on public.app_assistente_mensagens
  for select to authenticated
  using (
    exists (
      select 1
      from public.app_assistente_sessoes s
      join public.app_usuarios u on u.id = s.user_id
      where s.id = sessao_id
        and s.user_id = auth.uid()
        and u.ativo = true
    )
  );

drop policy if exists "assistente_mensagens_insert_own" on public.app_assistente_mensagens;
create policy "assistente_mensagens_insert_own" on public.app_assistente_mensagens
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.app_assistente_sessoes s
      join public.app_usuarios u on u.id = s.user_id
      where s.id = sessao_id
        and s.user_id = auth.uid()
        and u.ativo = true
    )
  );

drop policy if exists "assistente_mensagens_delete_own" on public.app_assistente_mensagens;
create policy "assistente_mensagens_delete_own" on public.app_assistente_mensagens
  for delete to authenticated
  using (
    exists (
      select 1
      from public.app_assistente_sessoes s
      join public.app_usuarios u on u.id = s.user_id
      where s.id = sessao_id
        and s.user_id = auth.uid()
        and u.ativo = true
    )
  );

-- Auditoria: próprio usuário
drop policy if exists "assistente_auditoria_select_own" on public.app_assistente_auditoria;
create policy "assistente_auditoria_select_own" on public.app_assistente_auditoria
  for select to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true
    )
  );

drop policy if exists "assistente_auditoria_insert_own" on public.app_assistente_auditoria;
create policy "assistente_auditoria_insert_own" on public.app_assistente_auditoria
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true
    )
  );

grant select, insert, update, delete on public.app_assistente_sessoes to authenticated;
grant select, insert, delete on public.app_assistente_mensagens to authenticated;
grant select, insert on public.app_assistente_auditoria to authenticated;
grant all on public.app_assistente_sessoes to service_role;
grant all on public.app_assistente_mensagens to service_role;
grant all on public.app_assistente_auditoria to service_role;
