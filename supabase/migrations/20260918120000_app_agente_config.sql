-- Prompt do Agente de IA (Configurações → Agente de IA)
-- Singleton: uma linha id=1 com rascunho + versão publicada.

create table if not exists public.app_agente_config (
  id                         smallint primary key default 1 check (id = 1),
  persona_rascunho           text not null default '',
  mensagem_abertura_rascunho text not null default '',
  persona                    text not null default '',
  mensagem_abertura          text not null default '',
  versao                     integer not null default 0,
  published_at               timestamptz,
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid references auth.users (id),
  published_by               uuid references auth.users (id)
);

comment on table public.app_agente_config is
  'Prompt/persona do agente de IA: rascunho editável e versão publicada';
comment on column public.app_agente_config.persona is
  'Persona/regras publicadas (produção)';
comment on column public.app_agente_config.persona_rascunho is
  'Rascunho da persona ainda não publicado';
comment on column public.app_agente_config.versao is
  'Contador incremental a cada publicação';

alter table public.app_agente_config enable row level security;

drop policy if exists "agente_config_select" on public.app_agente_config;
create policy "agente_config_select" on public.app_agente_config
  for select to authenticated
  using (app_private.is_authenticated_user());

drop policy if exists "agente_config_update_advogado" on public.app_agente_config;
create policy "agente_config_update_advogado" on public.app_agente_config
  for update to authenticated
  using (
    exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true and u.papel = 'advogado'
    )
  )
  with check (
    exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true and u.papel = 'advogado'
    )
  );

grant select, update on public.app_agente_config to authenticated;
grant all on public.app_agente_config to service_role;

insert into public.app_agente_config (id)
values (1)
on conflict (id) do nothing;
