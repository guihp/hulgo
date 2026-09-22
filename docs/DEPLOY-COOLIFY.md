# Deploy no Coolify

Guia para subir o **Sistema Hugo** (Next.js 16) no [Coolify](https://coolify.io) via Dockerfile.

## Pré-requisitos

- Instância Coolify configurada (VPS com Docker)
- Repositório Git com este projeto
- Projeto Supabase já criado e migrations aplicadas (`supabase/migrations/`)
- Edge Functions deployadas no Supabase (mensagem-ingest, kanban-*, etc.)
- n8n com os fluxos de integração configurados

## 1. Criar o recurso no Coolify

1. **New Resource** → **Application**
2. Conecte o repositório Git (GitHub/GitLab/Gitea)
3. **Build Pack**: escolha **Dockerfile**
4. **Dockerfile location**: `Dockerfile` (raiz do repo)
5. **Port**: `3000`
6. **Health check path**: `/api/health`

## 2. Variáveis de ambiente

Use `.env.example` como referência completa.

### Build time (obrigatório no build)

Essas variáveis precisam estar em **Build Variables** no Coolify — são embutidas no bundle do cliente:

| Variável | Descrição |
|----------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anon/publishable |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Chave pública VAPID (Web Push) |

### Runtime (servidor)

Configure em **Environment Variables** (runtime):

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `SUPABASE_SERVICE_ROLE_KEY` | Sim | Service role (somente servidor) |
| `EVOGO_API_URL` | Sim* | URL da API EvoGo |
| `EVOGO_GLOBAL_API_KEY` | Sim* | API key global EvoGo |
| `EVOGO_INSTANCE_NAME` | Sim* | Nome da instância WhatsApp |
| `EVOGO_INSTANCE_ID` | Não | Id da instância (opcional) |
| `EVOGO_INSTANCE_TOKEN` | Não | Token da instância (opcional) |
| `N8N_WEBHOOK_APROVACAO` | Sim | Webhook n8n — despausar IA após aprovação |
| `N8N_WEBHOOK_CONTROLE_IA` | Recomendado | Webhook pausar/despausar IA |
| `N8N_INTEGRACAO_TOKEN` | Recomendado | Token das rotas `/api/integracao/*` |
| `CRON_SECRET` | Recomendado | Protege `/api/cron/datajud`, `/api/cron/prazos-notificar`, etc. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Sim† (build) | Chave pública VAPID (também em Build Variables) |
| `VAPID_PRIVATE_KEY` | Sim† | Chave privada VAPID (somente runtime) |
| `VAPID_SUBJECT` | Sim† | Contato válido no JWT VAPID. Use `mailto:voce@seudominio.com` ou `https://seudominio.com`. **Nunca** `mailto:admin@localhost` — a Apple rejeita com `BadJwtToken` e o push fica `sent: 0`. |
| `PUSH_WEBHOOK_SECRET` | Sim† | Secret do webhook Supabase → `/api/push/webhook` |
| `DATAJUD_API_KEY` | Não | Override da chave DataJud |

\* Necessário para envio de WhatsApp (aprovações, documentos, atendimentos).
† Necessário para PWA Web Push (notificações com o app fechado). Gerar com `npx web-push generate-vapid-keys`.

**Nunca** exponha `SUPABASE_SERVICE_ROLE_KEY` nem tokens em variáveis `NEXT_PUBLIC_*`.

## 3. Domínio e HTTPS

1. Em **Domains**, adicione o domínio (ex.: `sistema.seudominio.com`)
2. Ative **HTTPS** (Let's Encrypt automático no Coolify)
3. Após o deploy, atualize no Supabase Dashboard → **Authentication → URL Configuration**:
   - **Site URL**: `https://sistema.seudominio.com`
   - **Redirect URLs**: `https://sistema.seudominio.com/**`

## 4. Deploy

1. Salve as variáveis
2. Clique em **Deploy**
3. Aguarde o build (npm ci + next build) e o container subir
4. Verifique: `https://sistema.seudominio.com/api/health` → `{"status":"ok",...}`

## 5. Cron — reconsulta DataJud

O endpoint `GET /api/cron/datajud` reconsulta processos com `monitorar_dias` vencido.

No Coolify, crie um **Scheduled Task** (ou use crontab na VPS):

```bash
curl -fsS -H "x-cron-secret: SEU_CRON_SECRET" \
  https://sistema.seudominio.com/api/cron/datajud
```

Sugestão: diário às 08:00 (`0 8 * * *`).

## 5b. Cron — lembretes de prazos

```bash
curl -fsS -H "x-cron-secret: SEU_CRON_SECRET" \
  https://sistema.seudominio.com/api/cron/prazos-notificar
```

Sugestão: a cada **5 minutos** (`*/5 * * * *`) — lembrete “5 min antes” só dispara
se o cron rodar nessa janela; `*/15` pode perder lembretes curtos.

```bash
# Coolify Scheduled Task (exemplo)
*/5 * * * * curl -fsS -H "x-cron-secret: SEU_CRON_SECRET" \
  https://sistema.seudominio.com/api/cron/prazos-notificar
```

Envia Web Push 1× por lembrete em `app_prazos_lembretes` quando
`fire_at = deadline(data_prazo + hora_prazo, America/Sao_Paulo) − offset_minutes`
já passou (dedupe em `app_prazos_alertas` por `lembrete_id`).

Criação de prazo/aprovação (painel ou n8n) dispara push imediato via trigger
`notify_painel_push_webhook` → `POST /api/push/webhook` (INSERT em `app_prazos`
/ `aprovacoes_pendentes`).

### Troubleshooting push / lembretes

| Sintoma | Causa provável | O que fazer |
|--------|----------------|-------------|
| Push na **criação** do prazo não chega | `net._http_response.status_code = 405` ou `307` → `/login` | Redeploy do app com `lib/supabase/middleware.ts` (rota pública `/api/push/webhook`). Teste: `curl -X POST …/api/push/webhook` deve retornar **401** (sem secret), não redirect. |
| Lembrete 5 min não chega | Cron Coolify ausente ou intervalo > 5 min | Scheduled Task `*/5 * * * *` no endpoint acima; confira `CRON_SECRET` no container. |
| Cron OK, `enviados: 0`, `vapid skip` | `VAPID_*` ausente no Coolify | Definir `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. |
| Webhook `sent: 0` / Apple `BadJwtToken` | `VAPID_SUBJECT=mailto:admin@localhost` (inválido na Apple) | Trocar para `mailto:voce@seudominio.com` ou `https://seudominio.com`, redeploy, e **reativar** o push no app (novas subscriptions). |
| `já notificado` no relatório do cron | Dedupe normal | Esperado após o primeiro envio por `lembrete_id`. |

Diagnóstico SQL (Supabase): prazo + `app_prazos_lembretes` + linhas em `app_prazos_alertas`;
últimas respostas HTTP do trigger: `select id, status_code, created from net._http_response order by created desc limit 5`.
Smoke local do cron (com secret de produção): `GET /api/cron/prazos-notificar` header `x-cron-secret`.

## 5c. Webhook Supabase → Web Push

No Supabase Dashboard → **Database → Webhooks** (ou **Integrations → Database Webhooks**), crie um webhook HTTP para cada evento abaixo, apontando para:

`https://sistema.seudominio.com/api/push/webhook`

**HTTP Headers:**

| Header | Valor |
|--------|-------|
| `Content-Type` | `application/json` |
| `x-push-webhook-secret` | o mesmo valor de `PUSH_WEBHOOK_SECRET` |

**Eventos (tabela / evento):**

| Tabela | Eventos | Filtro no app |
|--------|---------|---------------|
| `mensagens` | INSERT | ignora `type = bot` |
| `casos_novos` | INSERT, UPDATE | UPDATE só se `status` mudou |
| `documentos_cliente` | INSERT | ignora `origem = advogado` |
| `aprovacoes_pendentes` | INSERT | — |
| `app_prazos` | INSERT | — |

Payload esperado: formato Database Webhook (`type`, `table`, `record`, `old_record`).

Com o painel aberto, o Realtime continua mostrando toast; o Service Worker **não** reexibe push se houver janela focada (evita duplicar).

## 6. Primeiro usuário

Após o deploy, crie o advogado no Supabase:

1. **Authentication → Users** → criar usuário
2. SQL Editor:

```sql
INSERT INTO app_usuarios (id, nome, papel)
VALUES ('<uuid-do-auth-user>', 'Dr. Hulgo Fernando', 'advogado');
```

## 7. Testar localmente com Docker (opcional)

```bash
cp .env.example .env.local
# Preencha .env.local

docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY="$NEXT_PUBLIC_VAPID_PUBLIC_KEY" \
  -t sistema-hugo .

docker run --rm -p 3000:3000 --env-file .env.local sistema-hugo
```

Acesse [http://localhost:3000](http://localhost:3000).

## Troubleshooting

| Sintoma | Causa provável | Solução |
|---------|----------------|---------|
| Login não funciona / redirect loop | Site URL no Supabase incorreta | Ajustar URL Configuration |
| WhatsApp não envia | EvoGo env faltando | Conferir `EVOGO_*` no runtime |
| Aprovação não despausa IA | Webhook n8n | Conferir `N8N_WEBHOOK_APROVACAO` |
| Build falha com Supabase undefined | Build vars faltando | `NEXT_PUBLIC_*` em Build Variables |
| Build morre em `Running TypeScript` (exit 255, sem erro TS) | OOM na VPS durante o typecheck | VPS com ≥4 GB RAM/swap; Dockerfile já usa `NODE_OPTIONS=--max-old-space-size=3072` |
| Health check falha | App ainda iniciando | Aumentar `start-period` ou aguardar build |

## Arquitetura

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Coolify   │────▶│  Next.js     │────▶│  Supabase   │
│  (Docker)   │     │  (porta 3000)│     │  Postgres   │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
           EvoGo         n8n       DataJud API
         (WhatsApp)   (automação)  (processos)
```

O Supabase (banco + Edge Functions) e o n8n rodam **fora** do container Coolify — só o painel Next.js é deployado aqui.
