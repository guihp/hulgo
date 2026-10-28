-- 1) Ferramentas que a IA do WhatsApp aciona, em tempo real no chat
--    ("IA consultando a Justiça… aguardando resposta" → resultado).
create table if not exists public.app_ia_ferramenta_eventos (
  id bigint generated always as identity primary key,
  telefone text not null,
  ferramenta text not null,
  status text not null default 'aguardando' check (status in ('aguardando', 'ok', 'erro')),
  resumo text,
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz
);

create index if not exists idx_ia_ferramenta_eventos_tel
  on public.app_ia_ferramenta_eventos (telefone, iniciado_em desc);

alter table public.app_ia_ferramenta_eventos enable row level security;

drop policy if exists app_ia_ferramenta_eventos_select on public.app_ia_ferramenta_eventos;
create policy app_ia_ferramenta_eventos_select on public.app_ia_ferramenta_eventos
  for select to authenticated using (app_private.is_authenticated_user());

do $$
begin
  alter publication supabase_realtime add table public.app_ia_ferramenta_eventos;
exception when duplicate_object then null;
end $$;

-- 2) Etiqueta automática com a etapa do funil (chave 'funil:<coluna>').
--    Trocada sempre que o card muda de coluna — pela IA, pela equipe ou por RPC.
create or replace function public.sincronizar_etiqueta_funil(p_telefone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contato text := public.normalize_phone_digits(p_telefone);
  v_status text;
  v_label text;
  v_cor text;
  v_ordem int;
  v_etq bigint;
begin
  if coalesce(v_contato, '') = '' then
    return;
  end if;

  select c.status into v_status
  from public.casos_novos c
  where c.telefone in (v_contato, p_telefone)
  order by c.updated_at desc nulls last, c.created_at desc
  limit 1;

  if v_status is not null then
    select id into v_etq from public.app_etiquetas where chave = 'funil:' || v_status;
    if v_etq is null then
      select label, ordem into v_label, v_ordem
      from public.app_kanban_colunas where chave = v_status;
      v_label := coalesce(v_label, initcap(replace(v_status, '_', ' ')));
      v_cor := case v_status
        when 'em_atendimento' then 'azul'
        when 'abertura_processo' then 'verde'
        when 'aguardando_analise' then 'amarelo'
        when 'aguardando_aprovacao' then 'laranja'
        when 'atendimento_humano' then 'rosa'
        else 'cinza'
      end;
      if exists (select 1 from public.app_etiquetas where nome = v_label) then
        v_label := v_label || ' (funil)';
      end if;
      insert into public.app_etiquetas (nome, cor, ordem, chave)
      values (v_label, v_cor, 1000 + coalesce(v_ordem, 0), 'funil:' || v_status)
      on conflict (chave) where chave is not null do update set chave = excluded.chave
      returning id into v_etq;
    end if;
  end if;

  delete from public.app_conversa_etiquetas ce
  using public.app_etiquetas e
  where ce.etiqueta_id = e.id
    and e.chave like 'funil:%'
    and ce.contact_norm = v_contato
    and (v_etq is null or e.id <> v_etq);

  if v_etq is not null then
    insert into public.app_conversa_etiquetas (contact_norm, etiqueta_id)
    values (v_contato, v_etq)
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.sincronizar_etiqueta_funil(text) from public, anon, authenticated;

create or replace function public.casos_novos_etiqueta_funil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sincronizar_etiqueta_funil(old.telefone);
    return old;
  end if;
  perform public.sincronizar_etiqueta_funil(new.telefone);
  if tg_op = 'UPDATE' and old.telefone is distinct from new.telefone then
    perform public.sincronizar_etiqueta_funil(old.telefone);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_casos_novos_etiqueta_funil on public.casos_novos;
create trigger trg_casos_novos_etiqueta_funil
  after insert or delete or update of status, telefone on public.casos_novos
  for each row execute function public.casos_novos_etiqueta_funil();

-- Coluna renomeada no Kanban → etiqueta acompanha.
create or replace function public.kanban_coluna_renomeia_etiqueta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.label is distinct from old.label then
    begin
      update public.app_etiquetas set nome = new.label where chave = 'funil:' || new.chave;
    exception when unique_violation then
      update public.app_etiquetas set nome = new.label || ' (funil)' where chave = 'funil:' || new.chave;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_kanban_coluna_etiqueta on public.app_kanban_colunas;
create trigger trg_kanban_coluna_etiqueta
  after update of label on public.app_kanban_colunas
  for each row execute function public.kanban_coluna_renomeia_etiqueta();

-- Conversas que já existem.
select public.sincronizar_etiqueta_funil(t.telefone)
from (select distinct telefone from public.casos_novos where telefone is not null) t;
