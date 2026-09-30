-- Quatro funis de processos: Cível | Administrativo Previdenciário |
-- Judicial Previdenciário | Concedidos.
-- A chave `previdenciario` continua existindo e passa a significar
-- "Judicial Previdenciário" (compatível com n8n e dados existentes).

-- ---------------------------------------------------------------------------
-- 1. Valores permitidos de funil/área
-- ---------------------------------------------------------------------------
alter table public.app_processo_colunas
  drop constraint if exists app_processo_colunas_funil_check;
alter table public.app_processo_colunas
  add constraint app_processo_colunas_funil_check
  check (funil in ('civel', 'administrativo', 'previdenciario', 'concedido'));

alter table public.processos_clientes
  drop constraint if exists processos_clientes_area_check;
alter table public.processos_clientes
  add constraint processos_clientes_area_check
  check (
    area is null
    or area in ('civel', 'administrativo', 'previdenciario', 'concedido')
  );

comment on column public.app_processo_colunas.funil is
  'civel | administrativo | previdenciario (judicial) | concedido (mesmo valor de processos_clientes.area)';
comment on column public.processos_clientes.area is
  'civel | administrativo | previdenciario (judicial) | concedido — define o funil em /processos';
comment on column public.processos_clientes.numero_processo is
  'Nº CNJ (20 dígitos) nos funis judiciais; nº do requerimento/NB (ou vazio) em administrativo/concedido';

-- ---------------------------------------------------------------------------
-- 2. Colunas dos novos funis
-- ---------------------------------------------------------------------------
insert into public.app_processo_colunas (funil, chave, label, ordem, cor)
values
  ('administrativo', 'requerimento_protocolar', 'Requerimento a protocolar', 10, 'slate'),
  ('administrativo', 'protocolado_analise', 'Protocolado / Em análise INSS', 20, 'blue'),
  ('administrativo', 'exigencia', 'Exigência', 30, 'amber'),
  ('administrativo', 'pericia_avaliacao', 'Perícia / Avaliação social', 40, 'violet'),
  ('administrativo', 'indeferido', 'Indeferido (avaliar recurso/judicial)', 50, 'rose'),
  ('administrativo', 'recurso_administrativo', 'Recurso administrativo', 60, 'orange'),
  ('concedido', 'aguardando_implantacao', 'Concedido — aguardando implantação', 10, 'cyan'),
  ('concedido', 'implantado', 'Implantado', 20, 'emerald'),
  ('concedido', 'aguardando_rpv_precatorio', 'Aguardando RPV/Precatório', 30, 'amber'),
  ('concedido', 'pago_honorarios', 'Pago / Honorários recebidos', 40, 'violet'),
  ('concedido', 'arquivado', 'Arquivado', 90, 'slate')
on conflict (funil, chave) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Normalização de área (texto livre de IA/n8n) + coluna válida do funil
-- ---------------------------------------------------------------------------
create or replace function public.processos_clientes_normaliza_funil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_area text;
begin
  v_area := lower(coalesce(new.area, ''));
  new.area := case
    when v_area like '%conced%' then 'concedido'
    when v_area like '%admin%' then 'administrativo'
    when v_area like '%civ%' or v_area like '%cív%' then 'civel'
    else 'previdenciario'
  end;

  if tg_op = 'INSERT'
     or new.funil_coluna is null
     or new.funil_coluna is distinct from old.funil_coluna
     or new.area is distinct from old.area then
    if new.funil_coluna is null or not exists (
      select 1 from public.app_processo_colunas c
      where c.funil = new.area and c.chave = new.funil_coluna and c.ativo = true
    ) then
      new.funil_coluna := (
        select c.chave from public.app_processo_colunas c
        where c.funil = new.area and c.ativo = true
        order by c.ordem, c.label
        limit 1
      );
    end if;
  end if;

  return new;
end;
$$;
