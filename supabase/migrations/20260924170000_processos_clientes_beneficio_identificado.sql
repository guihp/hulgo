-- Benefício tipado no processo (independente de casos_novos.beneficio_identificado)
alter table public.processos_clientes
  add column if not exists beneficio_identificado text;

comment on column public.processos_clientes.beneficio_identificado is
  'Tipo de benefício/caso (label de app_tipos_caso); independente da ficha de atendimento';

-- Backfill leve: descricao_caso era usada como depósito do benefício ao abrir processo a partir do caso
update public.processos_clientes p
set beneficio_identificado = t.label
from public.app_tipos_caso t
where p.beneficio_identificado is null
  and p.descricao_caso is not null
  and (
    lower(trim(p.descricao_caso)) = lower(t.label)
    or lower(trim(p.descricao_caso)) like 'benefício: ' || lower(t.label) || '%'
    or lower(trim(p.descricao_caso)) like 'beneficio: ' || lower(t.label) || '%'
  );
