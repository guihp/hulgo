-- Ficha: advogado autenticado (app_usuarios ativo) pode criar pastas,
-- gravar documentos_cliente e enviar arquivos ao bucket mensagens-media.
-- O INSERT autenticado em documentos_cliente não existia; o upload de storage
-- só permitia o path ^[0-9]+/out- (não cobre clientes/... nem escritorio/...).

-- documentos_pastas ---------------------------------------------------------
drop policy if exists "documentos_pastas_select" on public.documentos_pastas;
drop policy if exists "documentos_pastas_insert" on public.documentos_pastas;
drop policy if exists "documentos_pastas_update" on public.documentos_pastas;
drop policy if exists "documentos_pastas_delete" on public.documentos_pastas;

create policy "documentos_pastas_select" on public.documentos_pastas
  for select to authenticated
  using (app_private.is_authenticated_user());

create policy "documentos_pastas_insert" on public.documentos_pastas
  for insert to authenticated
  with check (app_private.is_authenticated_user());

create policy "documentos_pastas_update" on public.documentos_pastas
  for update to authenticated
  using (app_private.is_authenticated_user())
  with check (app_private.is_authenticated_user());

create policy "documentos_pastas_delete" on public.documentos_pastas
  for delete to authenticated
  using (app_private.is_authenticated_user());

grant select, insert, update, delete on public.documentos_pastas to authenticated;
grant all on public.documentos_pastas to service_role;
grant usage, select on sequence public.documentos_pastas_id_seq to authenticated, service_role;

-- documentos_cliente --------------------------------------------------------
drop policy if exists "documentos_cliente_insert_authenticated" on public.documentos_cliente;
drop policy if exists "documentos_cliente_update_authenticated" on public.documentos_cliente;
drop policy if exists "documentos_cliente_delete_authenticated" on public.documentos_cliente;

create policy "documentos_cliente_insert_authenticated"
  on public.documentos_cliente for insert to authenticated
  with check (app_private.is_authenticated_user());

create policy "documentos_cliente_update_authenticated"
  on public.documentos_cliente for update to authenticated
  using (app_private.is_authenticated_user())
  with check (app_private.is_authenticated_user());

create policy "documentos_cliente_delete_authenticated"
  on public.documentos_cliente for delete to authenticated
  using (app_private.is_authenticated_user());

grant select, insert, update, delete on public.documentos_cliente to authenticated;
grant all on public.documentos_cliente to service_role;

-- storage.objects: upload autenticado em mensagens-media (qualquer path)
drop policy if exists "Authenticated upload mensagens-media" on storage.objects;
drop policy if exists "Authenticated update mensagens-media" on storage.objects;
drop policy if exists "Authenticated delete mensagens-media" on storage.objects;

create policy "Authenticated upload mensagens-media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'mensagens-media'
    and app_private.is_authenticated_user()
  );

create policy "Authenticated update mensagens-media"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'mensagens-media'
    and app_private.is_authenticated_user()
  )
  with check (
    bucket_id = 'mensagens-media'
    and app_private.is_authenticated_user()
  );

create policy "Authenticated delete mensagens-media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'mensagens-media'
    and app_private.is_authenticated_user()
  );
