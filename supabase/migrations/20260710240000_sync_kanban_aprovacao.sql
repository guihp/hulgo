-- Sincroniza o funil Kanban com a fila de aprovações, sem depender da IA.
-- (conteúdo idêntico ao aplicado via MCP em 2026-07-10)

create or replace function public.kanban_on_aprovacao_criada()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_caso_id bigint;
begin
  if coalesce(new.status, 'pendente') <> 'pendente' then return new; end if;
  select c.id into v_caso_id from public.casos_novos c
  where public.normalize_phone_digits(c.telefone) = public.normalize_phone_digits(new.telefone_cliente)
    and c.status in ('em_atendimento', 'consultar_processo')
  order by c.created_at desc limit 1;
  if v_caso_id is not null then
    update public.casos_novos set status = 'aguardando_aprovacao', updated_at = now() where id = v_caso_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_kanban_aprovacao_criada on public.aprovacoes_pendentes;
create trigger trg_kanban_aprovacao_criada
  after insert on public.aprovacoes_pendentes
  for each row execute function public.kanban_on_aprovacao_criada();

create or replace function public.kanban_on_aprovacao_decidida()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_caso_id bigint;
begin
  if old.status <> 'pendente' or new.status = 'pendente' then return new; end if;
  if exists (
    select 1 from public.aprovacoes_pendentes a
    where a.status = 'pendente'
      and public.normalize_phone_digits(a.telefone_cliente) = public.normalize_phone_digits(new.telefone_cliente)
      and a.id <> new.id
  ) then return new; end if;
  select c.id into v_caso_id from public.casos_novos c
  where public.normalize_phone_digits(c.telefone) = public.normalize_phone_digits(new.telefone_cliente)
    and c.status = 'aguardando_aprovacao'
  order by c.created_at desc limit 1;
  if v_caso_id is not null then
    update public.casos_novos set status = 'em_atendimento', updated_at = now() where id = v_caso_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_kanban_aprovacao_decidida on public.aprovacoes_pendentes;
create trigger trg_kanban_aprovacao_decidida
  after update of status on public.aprovacoes_pendentes
  for each row execute function public.kanban_on_aprovacao_decidida();
