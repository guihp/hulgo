-- Horário do prazo (America/Sao_Paulo) junto com data_prazo (date).
-- NULL = legado: trata como 23:59:59 SP (fim do dia).
alter table public.app_prazos
  add column if not exists hora_prazo time null;

comment on column public.app_prazos.hora_prazo is
  'Horário do deadline em America/Sao_Paulo. NULL = legado (23:59:59 SP). fire_at = (data_prazo + hora_prazo) - offset_minutes.';

comment on column public.app_prazos_lembretes.offset_minutes is
  'Minutos antes do deadline (data_prazo + hora_prazo em America/Sao_Paulo; se hora_prazo null, 23:59:59). 0 = somente no horário.';
