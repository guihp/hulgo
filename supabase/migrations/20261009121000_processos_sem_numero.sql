-- Processos cadastrados antes de ter número (CNJ): número fica vazio e é
-- preenchido depois na tela de Processos ("Adicionar número").
ALTER TABLE public.processos_clientes ALTER COLUMN numero_processo DROP NOT NULL;

-- String vazia vira NULL para o filtro "sem número" ser um só.
UPDATE public.processos_clientes SET numero_processo = NULL
  WHERE numero_processo IS NOT NULL AND btrim(numero_processo) = '';
