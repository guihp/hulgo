-- Documentos enviados pelo escritório + fluxo de assinatura
alter table public.documentos_cliente
  add column if not exists requer_assinatura boolean not null default false,
  add column if not exists enviado_cliente_em timestamptz,
  add column if not exists assinado_em timestamptz;

-- Monitoramento automático de processos no DataJud
alter table public.processos_clientes
  add column if not exists monitorar_dias integer,
  add column if not exists ultima_consulta_datajud timestamptz,
  add column if not exists ultimo_movimento text;

comment on column public.processos_clientes.monitorar_dias is
  'null = monitoramento desligado; N = reconsultar DataJud a cada N dias (cron do sistema)';
