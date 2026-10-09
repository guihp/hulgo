-- Pagamentos: mesmo modelo de app_prazos (tipo = 'pagamento'), com valor.
-- Tela própria em /pagamentos; /prazos deixa de mostrá-los.
ALTER TABLE public.app_prazos
  ADD COLUMN IF NOT EXISTS valor_centavos bigint
  CHECK (valor_centavos IS NULL OR valor_centavos >= 0);

COMMENT ON COLUMN public.app_prazos.valor_centavos IS
  'Valor do pagamento em centavos (tipo = pagamento).';

-- Pagamentos pagos ficam como histórico: a limpeza de 30 dias só apaga
-- prazos/audiências concluídos.
create or replace function public.limpar_prazos_concluidos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.app_prazos
   where concluido
     and tipo <> 'pagamento'
     and concluido_em < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.limpar_prazos_concluidos() from public, anon, authenticated;
grant execute on function public.limpar_prazos_concluidos() to service_role;
