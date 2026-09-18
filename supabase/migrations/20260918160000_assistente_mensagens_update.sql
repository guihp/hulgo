-- Allow users to update their own assistant message tool_trace
-- (confirmation status after UI confirm/cancel)

drop policy if exists "assistente_mensagens_update_own" on public.app_assistente_mensagens;
create policy "assistente_mensagens_update_own" on public.app_assistente_mensagens
  for update to authenticated
  using (
    exists (
      select 1
      from public.app_assistente_sessoes s
      join public.app_usuarios u on u.id = s.user_id
      where s.id = sessao_id
        and s.user_id = auth.uid()
        and u.ativo = true
    )
  )
  with check (
    exists (
      select 1
      from public.app_assistente_sessoes s
      join public.app_usuarios u on u.id = s.user_id
      where s.id = sessao_id
        and s.user_id = auth.uid()
        and u.ativo = true
    )
  );

grant update on public.app_assistente_mensagens to authenticated;
