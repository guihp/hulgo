-- Pastas na ficha: documentos por pessoa (CPF/WhatsApp), não só por caso.
-- pasta: geral | caso:{id} | processo:{id} | custom:{nome}

alter table public.documentos_cliente
  alter column caso_id drop not null;

alter table public.documentos_cliente
  add column if not exists cpf text,
  add column if not exists contact_norm text,
  add column if not exists processo_id bigint references public.processos_clientes (id) on delete set null,
  add column if not exists pasta text not null default 'geral';

comment on column public.documentos_cliente.pasta is
  'geral | caso:{id} | processo:{id} | custom:{nome}';

alter table public.documentos_cliente
  drop constraint if exists documentos_cliente_pasta_chk;

alter table public.documentos_cliente
  add constraint documentos_cliente_pasta_chk
  check (
    pasta = 'geral'
    or pasta like 'caso:%'
    or pasta like 'processo:%'
    or pasta like 'custom:%'
  );

create index if not exists idx_documentos_cliente_cpf
  on public.documentos_cliente (cpf)
  where cpf is not null;

create index if not exists idx_documentos_cliente_contact_norm
  on public.documentos_cliente (contact_norm)
  where contact_norm is not null;

create index if not exists idx_documentos_cliente_pasta
  on public.documentos_cliente (pasta);

create index if not exists idx_documentos_cliente_processo_id
  on public.documentos_cliente (processo_id)
  where processo_id is not null;

-- Docs atuais ficam na pasta do caso, com CPF/telefone do caso
update public.documentos_cliente d
set
  pasta = 'caso:' || d.caso_id::text,
  cpf = nullif(regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g'), ''),
  contact_norm = nullif(public.normalize_phone_digits(c.telefone), '')
from public.casos_novos c
where d.caso_id = c.id;

create table if not exists public.documentos_pastas (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  cpf text,
  contact_norm text,
  nome text not null,
  constraint documentos_pastas_pessoa_chk check (
    (cpf is not null and btrim(cpf) <> '')
    or (contact_norm is not null and btrim(contact_norm) <> '')
  )
);

create unique index if not exists documentos_pastas_cpf_nome_uidx
  on public.documentos_pastas (cpf, lower(nome))
  where cpf is not null;

create unique index if not exists documentos_pastas_contact_nome_uidx
  on public.documentos_pastas (contact_norm, lower(nome))
  where contact_norm is not null and cpf is null;

create index if not exists documentos_pastas_cpf_idx
  on public.documentos_pastas (cpf)
  where cpf is not null;

create index if not exists documentos_pastas_contact_idx
  on public.documentos_pastas (contact_norm)
  where contact_norm is not null;

alter table public.documentos_pastas enable row level security;

drop policy if exists "documentos_pastas_select" on public.documentos_pastas;
create policy "documentos_pastas_select" on public.documentos_pastas
  for select to authenticated using (true);

drop policy if exists "documentos_pastas_insert" on public.documentos_pastas;
create policy "documentos_pastas_insert" on public.documentos_pastas
  for insert to authenticated with check (true);

drop policy if exists "documentos_pastas_update" on public.documentos_pastas;
create policy "documentos_pastas_update" on public.documentos_pastas
  for update to authenticated using (true) with check (true);

drop policy if exists "documentos_pastas_delete" on public.documentos_pastas;
create policy "documentos_pastas_delete" on public.documentos_pastas
  for delete to authenticated using (true);

grant select, insert, update, delete on public.documentos_pastas to authenticated;
grant all on public.documentos_pastas to service_role;

-- Ingest WhatsApp continua gravando no caso; agora também preenche pasta/cpf/telefone
create or replace function public.registrar_documento_cliente(
  p_nome_documento text,
  p_url_media text,
  p_descricao text default null,
  p_telefone text default null,
  p_cpf text default null,
  p_caso_id bigint default null,
  p_mensagem_id text default null,
  p_mensagem_row_id bigint default null,
  p_origem text default 'whatsapp',
  p_nome_cliente text default null
)
returns table(
  documento_id bigint,
  caso_id bigint,
  documentos_recebidos text,
  documentos_faltantes text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caso_id bigint;
  v_phone_norm text;
  v_cpf_norm text;
  v_cpf_caso text;
  v_phone_caso text;
  v_doc_id bigint;
  v_recebidos text;
  v_faltantes text;
begin
  if p_nome_documento is null or trim(p_nome_documento) = '' then
    raise exception 'nome_documento is required';
  end if;
  if p_url_media is null or trim(p_url_media) = '' then
    raise exception 'url_media is required';
  end if;

  v_phone_norm := public.normalize_phone_digits(p_telefone);
  v_cpf_norm := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');

  select c.id into v_caso_id
  from public.casos_novos c
  where
    (p_caso_id is not null and c.id = p_caso_id)
    or (v_cpf_norm <> '' and regexp_replace(c.cpf, '\D', '', 'g') = v_cpf_norm)
    or (
      v_phone_norm <> ''
      and public.normalize_phone_digits(c.telefone) = v_phone_norm
    )
  order by
    case when c.status = 'processo_finalizado' then 1 else 0 end,
    c.created_at desc
  limit 1;

  if v_caso_id is null then
    if v_phone_norm = '' and v_cpf_norm = '' and p_caso_id is null then
      raise exception 'Informe telefone, cpf ou caso_id para vincular o documento';
    end if;

    insert into public.casos_novos (
      telefone,
      cpf,
      nome,
      status,
      documentos_recebidos,
      documentos_faltantes
    ) values (
      nullif(v_phone_norm, ''),
      nullif(v_cpf_norm, ''),
      nullif(trim(coalesce(p_nome_cliente, '')), ''),
      'em_atendimento',
      '',
      ''
    )
    returning id into v_caso_id;
  end if;

  select
    nullif(regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g'), ''),
    nullif(public.normalize_phone_digits(c.telefone), '')
  into v_cpf_caso, v_phone_caso
  from public.casos_novos c
  where c.id = v_caso_id;

  insert into public.documentos_cliente (
    caso_id,
    nome_documento,
    descricao,
    url_media,
    mensagem_id,
    mensagem_row_id,
    origem,
    cpf,
    contact_norm,
    pasta
  ) values (
    v_caso_id,
    trim(p_nome_documento),
    nullif(trim(coalesce(p_descricao, '')), ''),
    trim(p_url_media),
    nullif(trim(coalesce(p_mensagem_id, '')), ''),
    p_mensagem_row_id,
    coalesce(nullif(trim(p_origem), ''), 'whatsapp'),
    coalesce(nullif(v_cpf_norm, ''), v_cpf_caso),
    coalesce(nullif(v_phone_norm, ''), v_phone_caso),
    'caso:' || v_caso_id::text
  )
  returning id into v_doc_id;

  select c.documentos_recebidos, c.documentos_faltantes
  into v_recebidos, v_faltantes
  from public.casos_novos c
  where c.id = v_caso_id;

  v_recebidos := public.doc_list_add(v_recebidos, trim(p_nome_documento));
  v_faltantes := public.doc_list_remove(v_faltantes, trim(p_nome_documento));

  update public.casos_novos
  set
    documentos_recebidos = v_recebidos,
    documentos_faltantes = v_faltantes,
    cpf = coalesce(nullif(v_cpf_norm, ''), cpf),
    nome = coalesce(nullif(trim(coalesce(p_nome_cliente, '')), ''), nome),
    updated_at = now()
  where id = v_caso_id;

  return query select v_doc_id, v_caso_id, v_recebidos, v_faltantes;
end;
$$;

grant execute on function public.registrar_documento_cliente(
  text, text, text, text, text, bigint, text, bigint, text, text
) to service_role;
