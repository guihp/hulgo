-- Parceiros comerciais (Configurações / Parceiros)

create table if not exists public.app_parceiros (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  cidade      text not null default '',
  telefone    text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  constraint app_parceiros_telefone_digits_chk
    check (telefone ~ '^\d+$'),
  constraint app_parceiros_telefone_br_chk
    check (char_length(telefone) = 13 and telefone like '55%')
);

create index if not exists app_parceiros_nome_idx
  on public.app_parceiros (nome);

create index if not exists app_parceiros_telefone_idx
  on public.app_parceiros (telefone);

comment on table public.app_parceiros is
  'Parceiros comerciais cadastrados em Configurações';
comment on column public.app_parceiros.telefone is
  'Celular BR WhatsApp: 55 + DDD + 9 + 8 dígitos (ex.: 5519981941604)';

alter table public.app_parceiros enable row level security;

drop policy if exists "parceiros_select" on public.app_parceiros;
create policy "parceiros_select" on public.app_parceiros
  for select to authenticated
  using (app_private.is_authenticated_user());

drop policy if exists "parceiros_insert" on public.app_parceiros;
create policy "parceiros_insert" on public.app_parceiros
  for insert to authenticated
  with check (app_private.is_authenticated_user());

drop policy if exists "parceiros_update" on public.app_parceiros;
create policy "parceiros_update" on public.app_parceiros
  for update to authenticated
  using (app_private.is_authenticated_user())
  with check (app_private.is_authenticated_user());

drop policy if exists "parceiros_delete" on public.app_parceiros;
create policy "parceiros_delete" on public.app_parceiros
  for delete to authenticated
  using (app_private.is_authenticated_user());

grant select, insert, update, delete on public.app_parceiros to authenticated;
grant all on public.app_parceiros to service_role;
