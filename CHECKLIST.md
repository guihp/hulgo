# Checklist — Critérios de aceite

## 1. Login funciona; usuário sem conta não vê nenhum dado
- [ ] Criar usuário em Supabase Auth (Dashboard → Authentication → Users)
- [ ] Inserir em `app_usuarios`: `INSERT INTO app_usuarios (id, nome, papel) VALUES ('<uuid>', 'Dr. Hulgo', 'advogado');`
- [ ] Acessar `/login` e autenticar com e-mail/senha
- [ ] Abrir painel em aba anônima sem login → redireciona para `/login`
- [ ] Policies `anon` revogadas nas tabelas de negócio

## 2. Linha nova em `casos_novos` aparece no Kanban sem F5 (ou em ≤60s)
- [ ] Inserir caso via SQL ou n8n: `INSERT INTO casos_novos (nome, cpf, status) VALUES ('[TESTE] Novo', '12345678901', 'aguardando_advogado');`
- [ ] Verificar card no Kanban via Realtime ou polling (≤60s)

## 3. Arrastar card entre colunas persiste `status` e sobrevive reload
- [ ] Mover card no Kanban (drag ou select mobile)
- [ ] Recarregar página — status mantido no banco

## 4. Aprovar pendência grava `aprovado` E chama webhook n8n
- [ ] Configurar `N8N_WEBHOOK_APROVACAO` no `.env.local`
- [ ] Como advogado, aprovar pendência em `/aprovacoes/[id]`
- [ ] Verificar `status = 'aprovado'` no banco
- [ ] Verificar log em `app_log_eventos` com `webhook_ok`

## 5. "Marcar processo criado" cria linha em `processos_clientes` com CPF normalizado
- [ ] Abrir caso em `/kanban/[id]`
- [ ] Clicar "Marcar processo criado" com nº CNJ válido
- [ ] Verificar INSERT em `processos_clientes` com CPF só dígitos
- [ ] Status do caso = `processo_criado`

## 6. Papel `secretaria` não consegue aprovar pendência (RLS)
- [ ] Criar usuário secretaria em `app_usuarios` com `papel = 'secretaria'`
- [ ] UI não mostra botões de aprovar/recusar
- [ ] Testar UPDATE direto via API com JWT de secretaria → deve falhar

## 7. Nenhuma tabela/coluna existente renomeada; INSERTs do n8n funcionam
- [ ] Tabelas `processos_clientes`, `aprovacoes_pendentes`, `casos_novos` intactas
- [ ] n8n continua inserindo com `service_role`
- [ ] Nova tabela `mensagens` recebe INSERTs do n8n
