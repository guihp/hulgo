-- Tipos de caso + checklist de documentos editável (Configurações / IA / Kanban)

create table if not exists public.app_tipos_caso (
  id          uuid primary key default gen_random_uuid(),
  chave       text not null unique,
  label       text not null,
  aliases     text[] not null default '{}',
  documentos  text[] not null default '{}',
  ativo       boolean not null default true,
  ordem       int not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists app_tipos_caso_ativo_ordem_idx
  on public.app_tipos_caso (ativo, ordem);

comment on table public.app_tipos_caso is
  'Tipos de caso/benefício e checklist de documentos cobrados pela IA';
comment on column public.app_tipos_caso.chave is
  'Slug único (ex.: incapacidade, bpc_loas)';
comment on column public.app_tipos_caso.aliases is
  'Trechos para match em beneficio_identificado (ordem de checagem = ordem da tabela)';
comment on column public.app_tipos_caso.documentos is
  'Lista de documentos na ordem em que a IA deve pedir';

alter table public.app_tipos_caso enable row level security;

drop policy if exists "tipos_caso_select" on public.app_tipos_caso;
create policy "tipos_caso_select" on public.app_tipos_caso
  for select to authenticated
  using (app_private.is_authenticated_user());

drop policy if exists "tipos_caso_insert" on public.app_tipos_caso;
create policy "tipos_caso_insert" on public.app_tipos_caso
  for insert to authenticated
  with check (app_private.is_authenticated_user());

drop policy if exists "tipos_caso_update" on public.app_tipos_caso;
create policy "tipos_caso_update" on public.app_tipos_caso
  for update to authenticated
  using (app_private.is_authenticated_user())
  with check (app_private.is_authenticated_user());

drop policy if exists "tipos_caso_delete" on public.app_tipos_caso;
create policy "tipos_caso_delete" on public.app_tipos_caso
  for delete to authenticated
  using (app_private.is_authenticated_user());

grant select, insert, update, delete on public.app_tipos_caso to authenticated;
grant all on public.app_tipos_caso to service_role;

-- Seed = CHECKLIST_POR_BENEFICIO + aliases de chaveDoBeneficio (prioridade = ordem)
insert into public.app_tipos_caso (chave, label, aliases, documentos, ativo, ordem)
values
  (
    'bpc_loas',
    'BPC/LOAS',
    array['bpc', 'loas'],
    array[
      'RG ou CNH',
      'CPF',
      'Comprovante de residência',
      'CadÚnico atualizado (folha resumo)',
      'Comprovante de renda de todos do grupo familiar',
      'Laudos e exames médicos (se deficiência)',
      'Receitas de medicamentos de uso contínuo',
      'CNIS de todos do grupo familiar'
    ],
    true,
    10
  ),
  (
    'pensao_morte',
    'Pensão por morte',
    array['pensão', 'pensao', 'morte'],
    array[
      'RG ou CNH',
      'CPF',
      'Comprovante de residência',
      'Certidão de óbito',
      'Certidão de casamento ou prova de união estável',
      'Certidão de nascimento dos filhos menores',
      'CNIS do falecido',
      'Provas de dependência econômica (se não presumida)'
    ],
    true,
    20
  ),
  (
    'salario_maternidade',
    'Salário-maternidade',
    array['maternidade'],
    array[
      'RG ou CNH',
      'CPF',
      'Comprovante de residência',
      'Certidão de nascimento da criança',
      'CNIS',
      'Provas de atividade rural no período (se rural)'
    ],
    true,
    30
  ),
  (
    'incapacidade',
    'Auxílio por incapacidade temporária',
    array[
      'incapacidade',
      'auxílio-doença',
      'auxilio-doenca',
      'doença',
      'doenca',
      'invalidez'
    ],
    array[
      'RG ou CNH',
      'CPF',
      'Comprovante de residência',
      'Laudos médicos recentes (com CID)',
      'Exames de imagem/laboratoriais',
      'Atestados de afastamento',
      'Receitas médicas',
      'CNIS',
      'Comunicação de acidente de trabalho — CAT (se acidente)'
    ],
    true,
    40
  ),
  (
    'rural_idade',
    'Aposentadoria rural por idade',
    array['rural'],
    array[
      'RG ou CNH',
      'CPF',
      'Comprovante de residência',
      'Autodeclaração de atividade rural',
      'CAF/DAP (ou extrato)',
      'Notas fiscais de venda de produção',
      'Contrato de arrendamento/parceria (se houver)',
      'Certidão de casamento (profissão lavrador)',
      'Ficha de sindicato rural / declaração',
      'CNIS'
    ],
    true,
    50
  ),
  (
    'urbana_idade',
    'Aposentadoria urbana por idade',
    array['aposentadoria', 'idade', 'urbana'],
    array[
      'RG ou CNH',
      'CPF',
      'Comprovante de residência',
      'CNIS',
      'Carteira de trabalho (todas as páginas de contrato)',
      'Carnês de contribuição (se autônomo)',
      'PPP/laudos (se atividade especial)'
    ],
    true,
    60
  ),
  (
    'outro',
    'Outro benefício',
    array['outro'],
    array[
      'RG ou CNH',
      'CPF',
      'Comprovante de residência',
      'CNIS'
    ],
    true,
    90
  )
on conflict (chave) do nothing;
