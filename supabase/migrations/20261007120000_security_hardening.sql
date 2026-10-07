-- Hardening de segurança (advisors do Supabase)
--
-- 1. View app_conversas_resumo: era SECURITY DEFINER e tinha SELECT para anon,
--    expondo a última mensagem de todas as conversas com a chave pública.
--    Agora respeita o RLS de quem consulta (mensagens_select = authenticated).
-- 2. Funções SECURITY DEFINER: EXECUTE revogado de PUBLIC/anon.
--    - Chamadas por n8n/Edge Functions/rotas de integração usam service_role.
--    - authenticated mantém só o necessário: app_get_papel (usado nas policies)
--      e upsert_mensagem (lib/actions/mensagens.ts → persistMensagem).
--    - Funções de trigger não precisam de EXECUTE para disparar.
-- 3. search_path fixo nas funções que não tinham.

-- 1. View ------------------------------------------------------------------
ALTER VIEW public.app_conversas_resumo SET (security_invoker = true);
REVOKE ALL ON public.app_conversas_resumo FROM anon;
REVOKE ALL ON public.app_conversas_resumo FROM authenticated;
GRANT SELECT ON public.app_conversas_resumo TO authenticated;

-- 2. SECURITY DEFINER ------------------------------------------------------
-- Usadas pelo painel com sessão do usuário: só tira anon/PUBLIC
REVOKE EXECUTE ON FUNCTION public.app_get_papel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_get_papel() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.upsert_mensagem(text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_mensagem(text, text, text, text, text, text, text, text, text) TO authenticated, service_role;

-- Integrações (service_role apenas)
REVOKE EXECUTE ON FUNCTION public.atualizar_dados_caso(text, text, text, text, text, text, text, boolean, text, boolean, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atualizar_dados_caso(text, text, text, text, text, text, text, boolean, text, boolean, text, text, text, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.consultar_cliente_kanban(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_cliente_kanban(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.mover_cliente_kanban(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mover_cliente_kanban(text, text, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.registrar_documento_cliente(text, text, text, text, text, bigint, text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_documento_cliente(text, text, text, text, text, bigint, text, bigint, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.registrar_documento_cliente(text, text, text, text, text, bigint, text, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_documento_cliente(text, text, text, text, text, bigint, text, bigint, text, text) TO service_role;

-- Funções de trigger / event trigger (ninguém chama via RPC)
REVOKE EXECUTE ON FUNCTION public.kanban_on_aprovacao_criada() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.kanban_on_aprovacao_decidida() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_painel_push_webhook() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.processos_clientes_normaliza_funil() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_caso_from_dados_cliente() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_log_status_change() FROM PUBLIC, anon, authenticated;

-- 3. search_path -----------------------------------------------------------
ALTER FUNCTION public.resolve_mensagens_contact_norm(text, text) SET search_path = public;
ALTER FUNCTION public.trg_mensagens_before_save() SET search_path = public;
ALTER FUNCTION public.normalize_phone_digits(text) SET search_path = public;
ALTER FUNCTION public.trg_casos_updated_at() SET search_path = public;
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.doc_list_add(text, text) SET search_path = public;
ALTER FUNCTION public.doc_list_remove(text, text) SET search_path = public;
ALTER FUNCTION public.kanban_status_rank(text) SET search_path = public;

-- Novas funções em public não ficam executáveis por anon por padrão
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
