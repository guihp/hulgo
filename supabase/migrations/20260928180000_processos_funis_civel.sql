-- Funis de processos (Previdenciário | Cível): colunas por funil, campos
-- estilo planilha em processos_clientes e dados de audiência em app_prazos.

-- ---------------------------------------------------------------------------
-- 1. Colunas personalizáveis por funil (processos_clientes.funil_coluna = chave)
-- ---------------------------------------------------------------------------
create table if not exists public.app_processo_colunas (
  id          uuid primary key default gen_random_uuid(),
  funil       text not null check (funil in ('previdenciario', 'civel')),
  chave       text not null,
  label       text not null,
  ordem       int not null default 100,
  ativo       boolean not null default true,
  cor         text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (funil, chave)
);

create index if not exists app_processo_colunas_funil_ativo_ordem_idx
  on public.app_processo_colunas (funil, ativo, ordem);

comment on table public.app_processo_colunas is
  'Colunas dos funis de processos. chave = valor gravado em processos_clientes.funil_coluna';
comment on column public.app_processo_colunas.funil is
  'previdenciario | civel (mesmo valor de processos_clientes.area)';
comment on column public.app_processo_colunas.cor is
  'Nome da cor Tailwind (slate, blue, amber, rose, emerald, violet...) usada no cabeçalho da coluna';

alter table public.app_processo_colunas enable row level security;

drop policy if exists "processo_colunas_select" on public.app_processo_colunas;
create policy "processo_colunas_select" on public.app_processo_colunas
  for select to authenticated
  using (app_private.is_authenticated_user());

drop policy if exists "processo_colunas_insert" on public.app_processo_colunas;
create policy "processo_colunas_insert" on public.app_processo_colunas
  for insert to authenticated
  with check (
    exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true and u.papel = 'advogado'
    )
  );

drop policy if exists "processo_colunas_update" on public.app_processo_colunas;
create policy "processo_colunas_update" on public.app_processo_colunas
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

drop policy if exists "processo_colunas_delete" on public.app_processo_colunas;
create policy "processo_colunas_delete" on public.app_processo_colunas
  for delete to authenticated
  using (
    exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true and u.papel = 'advogado'
    )
  );

grant select, insert, update, delete on public.app_processo_colunas to authenticated;
grant all on public.app_processo_colunas to service_role;

insert into public.app_processo_colunas (funil, chave, label, ordem, cor)
values
  ('previdenciario', 'ajuizado', 'Ajuizado', 10, 'blue'),
  ('previdenciario', 'pericia_audiencia', 'Perícia / Audiência', 20, 'violet'),
  ('previdenciario', 'sentenca', 'Sentença', 30, 'amber'),
  ('previdenciario', 'recurso', 'Recurso', 40, 'rose'),
  ('previdenciario', 'cumprimento_rpv', 'Cumprimento / RPV', 50, 'emerald'),
  ('previdenciario', 'arquivado', 'Arquivado', 90, 'slate'),
  ('civel', 'novo_andamento', 'Novo / Em andamento', 10, 'blue'),
  ('civel', 'providencia_escritorio', 'Providência do escritório', 20, 'rose'),
  ('civel', 'cumprimento_sentenca', 'Cumprimento de sentença', 30, 'amber'),
  ('civel', 'precatorio_aguardando', 'Precatório aguardando pagamento', 40, 'violet'),
  ('civel', 'pago_arquivado', 'Pago / Arquivado', 90, 'slate')
on conflict (funil, chave) do nothing;

-- ---------------------------------------------------------------------------
-- 2. processos_clientes: campos da planilha + funil
-- ---------------------------------------------------------------------------
alter table public.processos_clientes
  add column if not exists funil_coluna text,
  add column if not exists polo_ativo text,
  add column if not exists polo_passivo text,
  add column if not exists tipo_acao text,
  add column if not exists vara_comarca text,
  add column if not exists valor_centavos bigint,
  add column if not exists processo_origem text,
  add column if not exists situacao text,
  add column if not exists ultimo_andamento_data date,
  add column if not exists observacao text;

-- Normaliza área legada antes das constraints
update public.processos_clientes
set area = case
  when area is not null and (lower(area) like '%civ%' or lower(area) like '%cív%')
    then 'civel'
  else 'previdenciario'
end;

alter table public.processos_clientes
  alter column area set default 'previdenciario';

alter table public.processos_clientes
  drop constraint if exists processos_clientes_area_check;
alter table public.processos_clientes
  add constraint processos_clientes_area_check
  check (area is null or area in ('previdenciario', 'civel'));

alter table public.processos_clientes
  drop constraint if exists processos_clientes_situacao_check;
alter table public.processos_clientes
  add constraint processos_clientes_situacao_check
  check (
    situacao is null
    or situacao in (
      'providencia_escritorio',
      'cumprimento_pagamento',
      'verificar_1grau',
      'aguardando'
    )
  );

alter table public.processos_clientes
  drop constraint if exists processos_clientes_valor_centavos_check;
alter table public.processos_clientes
  add constraint processos_clientes_valor_centavos_check
  check (valor_centavos is null or valor_centavos >= 0);

create index if not exists processos_clientes_area_funil_coluna_idx
  on public.processos_clientes (area, funil_coluna);

comment on column public.processos_clientes.area is
  'previdenciario | civel — define o funil em /processos';
comment on column public.processos_clientes.funil_coluna is
  'Chave de app_processo_colunas (funil = area)';
comment on column public.processos_clientes.situacao is
  'Etiqueta: providencia_escritorio | cumprimento_pagamento | verificar_1grau | aguardando';

-- Normaliza área (texto livre de IA/n8n) e garante coluna válida do funil.
create or replace function public.processos_clientes_normaliza_funil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_area text;
begin
  v_area := lower(coalesce(new.area, ''));
  new.area := case
    when v_area like '%civ%' or v_area like '%cív%' then 'civel'
    else 'previdenciario'
  end;

  if tg_op = 'INSERT'
     or new.funil_coluna is null
     or new.funil_coluna is distinct from old.funil_coluna
     or new.area is distinct from old.area then
    if new.funil_coluna is null or not exists (
      select 1 from public.app_processo_colunas c
      where c.funil = new.area and c.chave = new.funil_coluna and c.ativo = true
    ) then
      new.funil_coluna := (
        select c.chave from public.app_processo_colunas c
        where c.funil = new.area and c.ativo = true
        order by c.ordem, c.label
        limit 1
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists processos_clientes_normaliza_funil on public.processos_clientes;
create trigger processos_clientes_normaliza_funil
  before insert or update on public.processos_clientes
  for each row execute function public.processos_clientes_normaliza_funil();

-- Backfill funil_coluna (trigger preenche a primeira coluna ativa)
update public.processos_clientes set funil_coluna = null where funil_coluna is null;

-- ---------------------------------------------------------------------------
-- 3. app_prazos: dados de audiência (tipo = 'audiencia')
-- ---------------------------------------------------------------------------
alter table public.app_prazos
  add column if not exists local text,
  add column if not exists modalidade text,
  add column if not exists link_audiencia text;

alter table public.app_prazos
  drop constraint if exists app_prazos_modalidade_check;
alter table public.app_prazos
  add constraint app_prazos_modalidade_check
  check (modalidade is null or modalidade in ('presencial', 'virtual'));
