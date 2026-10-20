-- Consulta automática do DataJud/CNJ para todos os processos com nº CNJ.
-- A movimentação do CNJ fica em colunas próprias para não sobrescrever o
-- "último andamento" escrito pela equipe (ultimo_movimento / ultimo_andamento_data).

alter table public.processos_clientes
  add column if not exists datajud_mov_data timestamptz,
  add column if not exists datajud_mov_texto text,
  add column if not exists datajud_mov_chave text,
  add column if not exists datajud_novidade_em timestamptz,
  add column if not exists datajud_resultado text;

comment on column public.processos_clientes.datajud_mov_data is 'Data da última movimentação encontrada no DataJud/CNJ.';
comment on column public.processos_clientes.datajud_mov_texto is 'Texto legível da última movimentação do DataJud/CNJ.';
comment on column public.processos_clientes.datajud_mov_chave is 'Chave interna (data|nome) para detectar movimentação nova.';
comment on column public.processos_clientes.datajud_novidade_em is 'Quando o robô detectou a última movimentação nova.';
comment on column public.processos_clientes.datajud_resultado is 'Motivo quando a última consulta não achou o processo (null = ok).';
comment on column public.processos_clientes.monitorar_dias is 'Intervalo da consulta automática no DataJud em dias. null = padrão (todo dia); 0 = não consultar.';

-- Configurações (Configurações → Consulta na Justiça). Valores "1"/"0".
insert into public.app_config (chave, valor) values
  ('datajud_auto', '1'),
  ('datajud_pendencias', '0'),
  ('datajud_ultima_rodada', '')
on conflict (chave) do nothing;
