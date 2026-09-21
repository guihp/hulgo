-- Histórico de versões do prompt do agente WhatsApp (rascunho + publicações).
-- Snapshots gravados ao salvar rascunho (estado anterior, se mudou) e ao publicar.

create table if not exists public.app_agente_config_versoes (
  id                 uuid primary key default gen_random_uuid(),
  persona            text not null,
  mensagem_abertura  text not null,
  publicado          boolean not null default false,
  fonte              text not null default 'ui'
    check (fonte in ('ui', 'assistente', 'publicacao', 'reverter')),
  motivo             text,
  config_versao      integer,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists app_agente_config_versoes_created_idx
  on public.app_agente_config_versoes (created_at desc);

create index if not exists app_agente_config_versoes_publicado_idx
  on public.app_agente_config_versoes (publicado, created_at desc);

comment on table public.app_agente_config_versoes is
  'Histórico de snapshots do prompt/persona do agente (rascunho e publicações)';
comment on column public.app_agente_config_versoes.publicado is
  'true = snapshot de conteúdo publicado; false = checkpoint de rascunho';
comment on column public.app_agente_config_versoes.fonte is
  'Origem: ui | assistente | publicacao | reverter';
comment on column public.app_agente_config_versoes.config_versao is
  'Contador app_agente_config.versao no momento do snapshot (útil em publicações)';

alter table public.app_agente_config_versoes enable row level security;

-- Leitura: qualquer usuário autenticado ativo (mesmo padrão de app_agente_config)
drop policy if exists "agente_config_versoes_select" on public.app_agente_config_versoes;
create policy "agente_config_versoes_select" on public.app_agente_config_versoes
  for select to authenticated
  using (app_private.is_authenticated_user());

-- Insert: só advogado (histórico escrito pelas server actions)
drop policy if exists "agente_config_versoes_insert_advogado" on public.app_agente_config_versoes;
create policy "agente_config_versoes_insert_advogado" on public.app_agente_config_versoes
  for insert to authenticated
  with check (
    exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true and u.papel = 'advogado'
    )
  );

-- Sem UPDATE/DELETE para authenticated — histórico imutável via painel

grant select, insert on public.app_agente_config_versoes to authenticated;
grant all on public.app_agente_config_versoes to service_role;
