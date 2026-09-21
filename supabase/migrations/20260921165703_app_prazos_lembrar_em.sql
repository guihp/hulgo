-- Lembrete pontual por data/hora no prazo
alter table public.app_prazos
  add column if not exists lembrar_em timestamptz null;

comment on column public.app_prazos.lembrar_em is
  'Quando enviar alerta push único (data+hora). Null = só alerta diário hoje/amanhã.';

create index if not exists app_prazos_lembrar_em_idx
  on public.app_prazos (lembrar_em)
  where lembrar_em is not null and not concluido;

-- Permitir tipo de alerta "lembrar" no dedupe
alter table public.app_prazos_alertas
  drop constraint if exists app_prazos_alertas_tipo_check;

alter table public.app_prazos_alertas
  add constraint app_prazos_alertas_tipo_check
  check (tipo = any (array['hoje'::text, 'amanha'::text, 'lembrar'::text]));

comment on table public.app_prazos_alertas is
  'Controle de envio de push de prazos (hoje/amanhã diário + lembrar pontual)';
