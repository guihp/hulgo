-- Vínculo opcional processo → parceiro cadastrado (Configurações / Parceiros)

alter table public.processos_clientes
  add column if not exists parceiro_id uuid
    references public.app_parceiros (id) on delete set null;

create index if not exists processos_clientes_parceiro_id_idx
  on public.processos_clientes (parceiro_id);

comment on column public.processos_clientes.parceiro_id is
  'Parceiro comercial (app_parceiros) vinculado ao processo; opcional';
