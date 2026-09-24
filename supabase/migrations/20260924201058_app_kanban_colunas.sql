-- Colunas personalizáveis do funil Kanban (casos_novos.status = chave)

create table if not exists public.app_kanban_colunas (
  id          uuid primary key default gen_random_uuid(),
  chave       text not null unique,
  label       text not null,
  ordem       int not null default 100,
  ativo       boolean not null default true,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists app_kanban_colunas_ativo_ordem_idx
  on public.app_kanban_colunas (ativo, ordem);

comment on table public.app_kanban_colunas is
  'Colunas do funil Kanban. chave = valor gravado em casos_novos.status';
comment on column public.app_kanban_colunas.chave is
  'Slug gravado em casos_novos.status (ex.: em_atendimento, custom_xyz)';
comment on column public.app_kanban_colunas.is_system is
  'Colunas reservadas (IA/n8n). Não apagar nem mudar a chave.';

alter table public.app_kanban_colunas enable row level security;

drop policy if exists "kanban_colunas_select" on public.app_kanban_colunas;
create policy "kanban_colunas_select" on public.app_kanban_colunas
  for select to authenticated
  using (app_private.is_authenticated_user());

drop policy if exists "kanban_colunas_insert" on public.app_kanban_colunas;
create policy "kanban_colunas_insert" on public.app_kanban_colunas
  for insert to authenticated
  with check (
    exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true and u.papel = 'advogado'
    )
  );

drop policy if exists "kanban_colunas_update" on public.app_kanban_colunas;
create policy "kanban_colunas_update" on public.app_kanban_colunas
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

drop policy if exists "kanban_colunas_delete" on public.app_kanban_colunas;
create policy "kanban_colunas_delete" on public.app_kanban_colunas
  for delete to authenticated
  using (
    is_system = false
    and exists (
      select 1 from public.app_usuarios u
      where u.id = auth.uid() and u.ativo = true and u.papel = 'advogado'
    )
  );

grant select, insert, update, delete on public.app_kanban_colunas to authenticated;
grant all on public.app_kanban_colunas to service_role;

-- Seed das colunas de sistema (mesmas chaves usadas pela IA / n8n)
insert into public.app_kanban_colunas (chave, label, ordem, ativo, is_system)
values
  ('em_atendimento', 'Em atendimento', 10, true, true),
  ('consultar_processo', 'Consultar processo', 20, true, true),
  ('abertura_processo', 'Abertura de processo', 30, true, true),
  ('aguardando_analise', 'Aguardando análise', 40, true, true),
  ('aguardando_aprovacao', 'Aguardando aprovação', 50, true, true),
  ('atendimento_humano', 'Solicitou atendimento humano', 60, true, true),
  ('processo_finalizado', 'Processo finalizado', 90, true, true)
on conflict (chave) do update
set
  label = excluded.label,
  is_system = true,
  updated_at = now();

-- Ranking: ordem da tabela; fallback numérico para status legado
create or replace function public.kanban_status_rank(p_status text)
returns int
language sql
stable
as $$
  select coalesce(
    (select c.ordem from public.app_kanban_colunas c where c.chave = p_status limit 1),
    case p_status
      when 'em_atendimento' then 10
      when 'consultar_processo' then 20
      when 'abertura_processo' then 30
      when 'aguardando_analise' then 40
      when 'aguardando_aprovacao' then 50
      when 'atendimento_humano' then 60
      when 'processo_finalizado' then 90
      when 'aguardando_advogado' then 30
      when 'em_analise' then 30
      when 'processo_criado' then 90
      when 'arquivado' then 90
      else 0
    end
  );
$$;

-- RPC mover: aceita qualquer coluna ativa (sistema + personalizadas)
create or replace function public.mover_cliente_kanban(
  p_telefone text,
  p_status text,
  p_motivo text default null,
  p_nome_cliente text default null
)
returns table(caso_id bigint, status text, telefone text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone_norm text;
  v_caso_id bigint;
  v_ok boolean;
begin
  v_phone_norm := public.normalize_phone_digits(p_telefone);
  if v_phone_norm = '' then
    raise exception 'telefone inválido';
  end if;

  select exists (
    select 1
    from public.app_kanban_colunas c
    where c.chave = p_status and c.ativo = true
  ) into v_ok;

  -- Fallback se seed ainda não rodou / coluna sistema antiga
  if not v_ok then
    v_ok := p_status = any (array[
      'em_atendimento',
      'consultar_processo',
      'abertura_processo',
      'aguardando_analise',
      'aguardando_aprovacao',
      'atendimento_humano',
      'processo_finalizado'
    ]);
  end if;

  if not v_ok then
    raise exception 'status inválido: %', p_status;
  end if;

  select c.id into v_caso_id
  from public.casos_novos c
  where public.normalize_phone_digits(c.telefone) = v_phone_norm
  order by c.created_at desc
  limit 1;

  if v_caso_id is null then
    insert into public.casos_novos (
      telefone,
      nome,
      status,
      documentos_recebidos,
      documentos_faltantes
    ) values (
      v_phone_norm,
      nullif(trim(coalesce(p_nome_cliente, '')), ''),
      p_status,
      '',
      ''
    )
    returning id into v_caso_id;
  else
    update public.casos_novos
    set
      status = p_status,
      nome = coalesce(nullif(trim(coalesce(p_nome_cliente, '')), ''), nome),
      updated_at = now()
    where id = v_caso_id;
  end if;

  insert into public.app_log_eventos (entidade, entidade_id, acao, payload)
  values (
    'casos_novos',
    v_caso_id,
    'kanban_mover',
    jsonb_build_object(
      'status', p_status,
      'telefone', v_phone_norm,
      'motivo', p_motivo
    )
  );

  return query select v_caso_id, p_status, v_phone_norm;
end;
$$;

grant execute on function public.mover_cliente_kanban(text, text, text, text) to service_role;
