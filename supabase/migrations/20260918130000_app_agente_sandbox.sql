-- Sandbox do agente (Configurações → Testar agente)
-- Sessões de teste com retenção de 7 dias + mídia em mensagens-media/sandbox/

create table if not exists public.app_agente_sandbox_sessoes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  versao          text not null check (versao in ('rascunho', 'publicada')),
  tipo_caso_id    uuid,
  tipo_caso_label text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists app_agente_sandbox_sessoes_user_idx
  on public.app_agente_sandbox_sessoes (user_id);
create index if not exists app_agente_sandbox_sessoes_created_idx
  on public.app_agente_sandbox_sessoes (created_at);

comment on table public.app_agente_sandbox_sessoes is
  'Sessões do sandbox de teste do agente de IA (retenção 7 dias)';

create table if not exists public.app_agente_sandbox_mensagens (
  id           uuid primary key default gen_random_uuid(),
  sessao_id    uuid not null references public.app_agente_sandbox_sessoes (id) on delete cascade,
  role         text not null check (role in ('user', 'assistant')),
  content      text not null default '',
  media_kind   text check (media_kind is null or media_kind in ('image', 'audio')),
  media_path   text,
  media_url    text,
  media_mime   text,
  transcript   text,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists app_agente_sandbox_mensagens_sessao_idx
  on public.app_agente_sandbox_mensagens (sessao_id, created_at);

comment on table public.app_agente_sandbox_mensagens is
  'Mensagens (texto/imagem/áudio) do sandbox do agente';

alter table public.app_agente_sandbox_sessoes enable row level security;
alter table public.app_agente_sandbox_mensagens enable row level security;

-- Sessões: dono autenticado (advogado) lê/cria/atualiza/apaga as próprias
drop policy if exists "sandbox_sessoes_select_own" on public.app_agente_sandbox_sessoes;
create policy "sandbox_sessoes_select_own" on public.app_agente_sandbox_sessoes
  for select to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true and u.papel = 'advogado'
    )
  );

drop policy if exists "sandbox_sessoes_insert_own" on public.app_agente_sandbox_sessoes;
create policy "sandbox_sessoes_insert_own" on public.app_agente_sandbox_sessoes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true and u.papel = 'advogado'
    )
  );

drop policy if exists "sandbox_sessoes_update_own" on public.app_agente_sandbox_sessoes;
create policy "sandbox_sessoes_update_own" on public.app_agente_sandbox_sessoes
  for update to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true and u.papel = 'advogado'
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true and u.papel = 'advogado'
    )
  );

drop policy if exists "sandbox_sessoes_delete_own" on public.app_agente_sandbox_sessoes;
create policy "sandbox_sessoes_delete_own" on public.app_agente_sandbox_sessoes
  for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true and u.papel = 'advogado'
    )
  );

-- Mensagens: via sessão do dono
drop policy if exists "sandbox_mensagens_select_own" on public.app_agente_sandbox_mensagens;
create policy "sandbox_mensagens_select_own" on public.app_agente_sandbox_mensagens
  for select to authenticated
  using (
    exists (
      select 1
      from public.app_agente_sandbox_sessoes s
      join public.app_usuarios u on u.id = s.user_id
      where s.id = sessao_id
        and s.user_id = auth.uid()
        and u.ativo = true
        and u.papel = 'advogado'
    )
  );

drop policy if exists "sandbox_mensagens_insert_own" on public.app_agente_sandbox_mensagens;
create policy "sandbox_mensagens_insert_own" on public.app_agente_sandbox_mensagens
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.app_agente_sandbox_sessoes s
      join public.app_usuarios u on u.id = s.user_id
      where s.id = sessao_id
        and s.user_id = auth.uid()
        and u.ativo = true
        and u.papel = 'advogado'
    )
  );

drop policy if exists "sandbox_mensagens_delete_own" on public.app_agente_sandbox_mensagens;
create policy "sandbox_mensagens_delete_own" on public.app_agente_sandbox_mensagens
  for delete to authenticated
  using (
    exists (
      select 1
      from public.app_agente_sandbox_sessoes s
      join public.app_usuarios u on u.id = s.user_id
      where s.id = sessao_id
        and s.user_id = auth.uid()
        and u.ativo = true
        and u.papel = 'advogado'
    )
  );

grant select, insert, update, delete on public.app_agente_sandbox_sessoes to authenticated;
grant select, insert, delete on public.app_agente_sandbox_mensagens to authenticated;
grant all on public.app_agente_sandbox_sessoes to service_role;
grant all on public.app_agente_sandbox_mensagens to service_role;
