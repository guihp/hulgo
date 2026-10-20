-- Contatos que não são clientes (outros escritórios, fornecedores…): a equipe tira o
-- card do Funil de vendas e a 1ª mensagem não recria o card para esse número.

create table if not exists public.funil_contatos_ignorados (
  telefone text primary key,
  nome text,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.funil_contatos_ignorados enable row level security;

drop policy if exists funil_ignorados_select on public.funil_contatos_ignorados;
create policy funil_ignorados_select on public.funil_contatos_ignorados
  for select to authenticated using (true);

drop policy if exists funil_ignorados_insert on public.funil_contatos_ignorados;
create policy funil_ignorados_insert on public.funil_contatos_ignorados
  for insert to authenticated with check (true);

drop policy if exists funil_ignorados_delete on public.funil_contatos_ignorados;
create policy funil_ignorados_delete on public.funil_contatos_ignorados
  for delete to authenticated using (true);

create or replace function public.garantir_caso_contato(p_telefone text, p_nome text default null)
returns table(caso_id bigint, criado boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tel text := public.normalize_phone_digits(p_telefone);
  v_id bigint;
begin
  if v_tel = '' then
    raise exception 'telefone inválido';
  end if;
  perform pg_advisory_xact_lock(hashtext('garantir_caso_contato:' || v_tel));

  select c.id into v_id
  from public.casos_novos c
  where public.normalize_phone_digits(c.telefone) = v_tel
  order by c.created_at desc
  limit 1;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  -- Contato marcado como "não é cliente": sem card.
  if exists (select 1 from public.funil_contatos_ignorados i where i.telefone = v_tel) then
    return;
  end if;

  insert into public.casos_novos (telefone, nome, status)
  values (v_tel, nullif(btrim(coalesce(p_nome, '')), ''), 'em_atendimento')
  returning id into v_id;
  return query select v_id, true;
end;
$function$;

revoke all on function public.garantir_caso_contato(text, text) from public, anon, authenticated;
grant execute on function public.garantir_caso_contato(text, text) to service_role;
