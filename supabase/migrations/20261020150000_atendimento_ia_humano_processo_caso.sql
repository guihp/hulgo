-- Etiquetas automáticas de quem está atendendo (IA × equipe) e ligação
-- funil de vendas (casos_novos) → processo (processos_clientes).

-- Etiqueta de sistema: identificada pela chave, trocada sozinha pelo atendimento.
ALTER TABLE public.app_etiquetas ADD COLUMN IF NOT EXISTS chave text;
CREATE UNIQUE INDEX IF NOT EXISTS app_etiquetas_chave_key
  ON public.app_etiquetas (chave) WHERE chave IS NOT NULL;
COMMENT ON COLUMN public.app_etiquetas.chave IS
  'ia_atendendo | atendimento_humano: etiquetas automáticas (não editáveis pelo painel).';

INSERT INTO public.app_etiquetas (nome, cor, ordem, chave) VALUES
  ('IA atendendo', 'roxo', -2, 'ia_atendendo'),
  ('Atendimento humano', 'rosa', -1, 'atendimento_humano')
ON CONFLICT (nome) DO UPDATE SET chave = EXCLUDED.chave;

-- Processo nascido de um caso do funil.
ALTER TABLE public.processos_clientes
  ADD COLUMN IF NOT EXISTS caso_id bigint REFERENCES public.casos_novos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_processos_clientes_caso_id
  ON public.processos_clientes (caso_id) WHERE caso_id IS NOT NULL;
COMMENT ON COLUMN public.processos_clientes.caso_id IS
  'Caso do funil de vendas que originou o processo (criado ao mover para Abertura de processo ou vinculado à mão).';
