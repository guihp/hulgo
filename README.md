# Sistema de Gestão — Boueres e Fonteles Advogados

Painel web para gestão do escritório de advocacia previdenciária, integrado ao Supabase (Postgres) alimentado pelo agente de IA no n8n via WhatsApp.

## Stack

- **Next.js 16** (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Supabase** (Auth, Postgres, Realtime)
- Deploy: **Coolify** (Docker) ou **Vercel**

## Setup local

```bash
npm install
cp .env.example .env.local
# Preencha as variáveis no .env.local
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000).

## Variáveis de ambiente

Veja `.env.example` para a lista completa. Resumo:

| Variável | Onde | Descrição |
|----------|------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Cliente + Servidor | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente + Servidor | Chave anon/publishable |
| `SUPABASE_SERVICE_ROLE_KEY` | **Somente servidor** | Service role (cron, integrações) |
| `N8N_WEBHOOK_APROVACAO` | **Somente servidor** | Webhook n8n — despausar IA após aprovação |
| `N8N_WEBHOOK_CONTROLE_IA` | **Somente servidor** | Pausar/despausar IA no n8n |
| `N8N_INTEGRACAO_TOKEN` | **Somente servidor** | Token das rotas `/api/integracao/*` |
| `EVOGO_*` | **Somente servidor** | EvoGo — envio WhatsApp |
| `CRON_SECRET` | **Somente servidor** | Protege `/api/cron/datajud` |
| `DATAJUD_API_KEY` | **Somente servidor** | Override opcional da chave DataJud |

**Nunca** use `service_role` no front-end.

## Primeiro usuário (advogado)

1. Crie o usuário em **Supabase Dashboard → Authentication → Users**
2. Execute no SQL Editor:

```sql
INSERT INTO app_usuarios (id, nome, papel)
VALUES ('<uuid-do-auth-user>', 'Dr. Hulgo Fernando', 'advogado');
```

## Migrations

As migrations estão em `supabase/migrations/` e foram aplicadas no projeto Supabase via MCP.

Ordem:
1. `app_usuarios_and_helpers` — usuários e funções de papel
2. `app_notas_and_log` — notas internas e log de eventos
3. `mensagens_table` — tabela de mensagens WhatsApp
4. `auth_rls_policies` — RLS authenticated (substitui anon)
5. `realtime_and_audit` — Realtime + triggers de auditoria
6. `seed_mensagens_teste` — dados de demonstração
7. `mensagens_ingest_functions` — funções SQL de ingest, view `app_conversas_resumo`, bucket `mensagens-media`

## Contrato n8n — Edge Functions (recomendado)

Projeto Hugo: `https://hzfvciamevimjzuvidcp.supabase.co`

| Endpoint | URL completa |
|----------|--------------|
| Texto | `https://hzfvciamevimjzuvidcp.supabase.co/functions/v1/mensagem-ingest` |
| Mídia | `https://hzfvciamevimjzuvidcp.supabase.co/functions/v1/mensagem-media-ingest` |

Autenticação: header `Authorization: Bearer <SERVICE_ROLE>` (configurar como secret no n8n — **nunca** commitar).

Fluxo detalhado: [docs/MENSAGENS-FLUXO.md](./docs/MENSAGENS-FLUXO.md)

## Contrato n8n — tabela `mensagens` (legado / fallback)

O n8n deve gravar mensagens **somente** em `mensagens` (não mais em `n8n_chat_histories_testehulgo`).

| Coluna | Tipo | Obrigatório | Descrição |
|--------|------|-------------|-----------|
| `phone` | text | sim | `5519999999999` ou `5519999999999@s.whatsapp.net` |
| `type` | text | sim | `lead` (cliente, n8n) ou `human`/`ai`/`bot` |
| `text` | text | não | Corpo da mensagem |
| `mensage_type` | text | não | `text`, `image`, `audio`, `document` |
| `mensagem_id` | text | recomendado | ID único Evolution (dedup) |
| `instancia` | text | não | Instância Evolution API |
| `session_id` | text | não | UUID de sessão LangChain |
| `conteudo_media` | text | não | URL ou referência de mídia |
| `plataforma` | text | default `whatsapp` | Plataforma de origem |

O trigger `mensagens_before_save` normaliza `contact_norm` automaticamente a partir de `phone`.

## Contrato n8n — webhook de aprovação

Quando o advogado aprova/recusa/responde no painel, o servidor chama:

```
POST {N8N_WEBHOOK_APROVACAO}
Content-Type: application/json

{
  "id_aprovacao": 123,
  "acao": "aprovar" | "recusar" | "responder",
  "texto_manual": "..." // apenas quando acao = responder
}
```

## Módulos

| Rota | Módulo |
|------|--------|
| `/` | Dashboard — KPIs, gráficos, ação imediata |
| `/kanban` | Kanban de casos novos (drag & drop) |
| `/aprovacoes` | Fila de aprovações human-in-the-loop |
| `/clientes` | CRUD processos + visão 360° |
| `/atendimentos` | Conversas WhatsApp via `mensagens` |
| `/relatorios` | Export CSV + relatório mensal |

## Papéis

- **advogado**: acesso total, incluindo aprovar pendências e excluir processos
- **secretaria**: visualiza tudo, move Kanban, edita cadastros — **não aprova** pendências

## Deploy Coolify (recomendado — VPS)

O projeto inclui `Dockerfile` com output `standalone` do Next.js.

1. No Coolify: **New Resource → Application → Dockerfile**
2. Porta `3000`, health check `/api/health`
3. **Build Variables**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. **Runtime**: demais variáveis de `.env.example`
5. Configure domínio + HTTPS e atualize **Site URL** no Supabase Auth

Guia completo: [docs/DEPLOY-COOLIFY.md](./docs/DEPLOY-COOLIFY.md)

## Deploy Vercel

1. Conecte o repositório à Vercel
2. Configure as env vars (`NEXT_PUBLIC_*` e `N8N_WEBHOOK_APROVACAO`)
3. Deploy automático a cada push

## Critérios de aceite

Veja [CHECKLIST.md](./CHECKLIST.md).
