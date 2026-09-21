# Checklist de benefícios (API para n8n / IA)

A lista de documentos cobrados pela IA deixa de ser só o texto do prompt: o
escritório edita em **Configurações → Tipos de caso e documentos da IA**.

## Endpoint primário (n8n) — Edge Function

Igual a `atualizar_dados_caso` / `caso-atualizar`:

```
GET https://hzfvciamevimjzuvidcp.supabase.co/functions/v1/checklist-beneficios
```

Auth (mesma service role key do Supabase que você cola em `caso-atualizar`):

- `Authorization: Bearer SEU_SUPABASE_SERVICE_ROLE_KEY`
- `apikey: SEU_SUPABASE_SERVICE_ROLE_KEY`

`verify_jwt` da Edge está **off**; a função valida service role no código (Bearer ou apikey).

Também aceita `POST` com body `{ "beneficio": "..." }` (mesmo shape de resposta).

### Todos os tipos ativos

```http
GET /functions/v1/checklist-beneficios
Authorization: Bearer SEU_SUPABASE_SERVICE_ROLE_KEY
apikey: SEU_SUPABASE_SERVICE_ROLE_KEY
```

```json
{
  "tipos": [
    {
      "chave": "incapacidade",
      "label": "Auxílio por incapacidade temporária",
      "aliases": ["incapacidade", "auxílio-doença", "doença"],
      "documentos": ["RG ou CNH", "CPF", "Comprovante de residência", "Laudos médicos recentes (com CID)", "..."]
    }
  ]
}
```

### Match por texto do benefício

```http
GET /functions/v1/checklist-beneficios?beneficio=aux%C3%ADlio%20por%20incapacidade
```

```json
{
  "beneficio": "auxílio por incapacidade",
  "match": {
    "chave": "incapacidade",
    "label": "Auxílio por incapacidade temporária",
    "aliases": ["incapacidade", "auxílio-doença", "..."],
    "documentos": ["RG ou CNH", "..."]
  }
}
```

No n8n, chame este endpoint após identificar o benefício e use
`match.documentos` (nessa ordem) no prompt / tool de cobrança de docs.

## Alternativa — Next API (painel)

`GET /api/integracao/checklist-beneficios`

Auth (rotas de integração do painel):

- header `x-integracao-token: <token>` **ou**
- `Authorization: Bearer <token>` (`N8N_INTEGRACAO_TOKEN`)

Mesmo JSON de resposta. Preferir a Edge no n8n para ficar igual às outras tools Supabase.

## Tool n8n (httpRequestTool)

Arquivo pronto para importar: [`n8n-tool-checklist-beneficios.json`](./n8n-tool-checklist-beneficios.json).

1. No n8n: **Workflow → Import from File** (ou cole o JSON no canvas).
2. Nos headers `Authorization` e `apikey`, substitua `SEU_SUPABASE_SERVICE_ROLE_KEY` pela **mesma** service role key usada em `atualizar_dados_caso` (Dashboard Supabase → Project Settings → API → `service_role`).
3. Conecte o nó `checklist_beneficios` ao AI Agent (`ai_tool`).
4. Detalhes e prompt: [`N8N-TOOLS-PROMPT.md`](./N8N-TOOLS-PROMPT.md) + [`PROMPT-AGENTE-IA.md`](./PROMPT-AGENTE-IA.md).

| Campo | Valor |
|-------|--------|
| **Name** | `checklist_beneficios` |
| **Method** | GET |
| **URL** | `https://hzfvciamevimjzuvidcp.supabase.co/functions/v1/checklist-beneficios` |
| **Query** | `beneficio` opcional via `$fromAI(...)` (vazio = todos os tipos ativos) |
| **Auth** | `Authorization: Bearer SEU_SUPABASE_SERVICE_ROLE_KEY` + `apikey: SEU_SUPABASE_SERVICE_ROLE_KEY` |

A tabela `app_tipos_caso` é editada no painel (Configurações); a IA lê via esta Edge (ou Next API).
