-- IA do WhatsApp para parceiros: o número cadastrado em app_parceiros conversa com
-- uma IA própria, que consulta os processos daquele parceiro e recebe casos novos.

-- Aprovações ganham tipo (consulta de andamento | processo novo), o parceiro que pediu,
-- os dados do processo a criar e o processo criado ao aprovar.
alter table public.aprovacoes_pendentes
  add column if not exists tipo text not null default 'consulta',
  add column if not exists parceiro_id uuid references public.app_parceiros(id) on delete set null,
  add column if not exists dados jsonb,
  add column if not exists processo_id bigint references public.processos_clientes(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'aprovacoes_pendentes_tipo_chk') then
    alter table public.aprovacoes_pendentes
      add constraint aprovacoes_pendentes_tipo_chk check (tipo in ('consulta', 'novo_processo'));
  end if;
end $$;

create index if not exists aprovacoes_pendentes_parceiro_idx
  on public.aprovacoes_pendentes (parceiro_id) where parceiro_id is not null;

-- Configuração da IA dos parceiros.
-- parceiros_modo: desligado | teste (só parceiros que também são números de teste) | ativo (todos)
alter table public.app_ia_whatsapp_config
  add column if not exists parceiros_modo text not null default 'teste',
  add column if not exists parceiros_consulta_direta boolean not null default false,
  add column if not exists parceiros_cadastro_direto boolean not null default false,
  add column if not exists prompt_parceiros text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_ia_whatsapp_config_parceiros_modo_chk') then
    alter table public.app_ia_whatsapp_config
      add constraint app_ia_whatsapp_config_parceiros_modo_chk
      check (parceiros_modo in ('desligado', 'teste', 'ativo'));
  end if;
end $$;
