-- O que a IA precisa saber de cada tipo de caso (requisitos, perguntas, cuidados).
-- Lido pela IA do WhatsApp (checklist_beneficios) e pelo assistente.
alter table public.app_tipos_caso
  add column if not exists orientacoes_ia text not null default '';
