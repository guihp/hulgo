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
| `CRON_SECRET` | Recomendado | Protege `/api/cron/datajud` |
| `DATAJUD_API_KEY` | Não | Override da chave DataJud |

\* Necessário para envio de WhatsApp (aprovações, documentos, atendimentos).

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
