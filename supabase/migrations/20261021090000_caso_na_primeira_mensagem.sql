-- Contato novo no WhatsApp vira card "Em atendimento" no Funil de vendas na
-- primeira mensagem (antes só nascia quando a IA registrava o caso).
-- Trava por telefone: várias mensagens seguidas não criam cards duplicados.
create or replace function public.garantir_caso_contato(p_telefone text, p_nome text default null)
returns table (caso_id bigint, criado boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
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

  insert into public.casos_novos (telefone, nome, status)
  values (v_tel, nullif(btrim(coalesce(p_nome, '')), ''), 'em_atendimento')
  returning id into v_id;
  return query select v_id, true;
end;
$$;

revoke all on function public.garantir_caso_contato(text, text) from public, anon, authenticated;
grant execute on function public.garantir_caso_contato(text, text) to service_role;
