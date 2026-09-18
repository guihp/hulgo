# Assistente interno do painel

Copiloto da equipe no Hulgo: conversa em linguagem natural no drawer do `AppShell` e
executa ferramentas tipadas no Next.js (sessão do usuário logado + RLS). **Não** reutiliza
o agente WhatsApp/n8n nem o sandbox de Configurações.

## Arquitetura

```
Drawer (AppShell) → server actions (lib/actions/assistente.ts)
                 → OpenAI chat + tool calling (lib/assistente/openai.ts)
                 → adapters (lib/assistente/tools.ts)
                 → server actions / queries existentes
                 → Supabase (sessões, mensagens, auditoria)
```

- **Orquestração:** Next.js, com `getAppUser` — papéis e RLS valem como no restante do painel.
- **Modelo:** mesmas variáveis `OPENAI_*` do sandbox (ver abaixo). Default de chat: `gpt-5.6-luna`.
- **Prompt:** fixo em `lib/assistente/prompt.ts` (separado do prompt WhatsApp / `app_agente_config`).
- **n8n:** fora do caminho crítico.

Arquivos principais:

| Peça | Caminho |
|---|---|
| Drawer UI | `components/assistente/assistente-drawer.tsx` |
| Actions | `lib/actions/assistente.ts` |
| Tools + loop | `lib/assistente/tools.ts`, `lib/assistente/write-tools.ts`, `lib/assistente/openai.ts` |
| Prompt | `lib/assistente/prompt.ts` |
| Migration | `supabase/migrations/20260918150000_app_assistente.sql` |
| Cron retenção | `app/api/cron/assistente` |

## Como abrir

1. Faça login no painel (usuário ativo em `app_usuarios`).
2. No header (ao lado do sino de notificações), clique no botão com ícone de sparkles
   (`aria-label="Abrir assistente"`, título “Assistente”).
3. Abre um sheet à direita (“Assistente interno”). A primeira abertura cria/reusa uma
   sessão e carrega o histórico.
4. Envie mensagens no composer; use “reiniciar” para limpar a conversa da sessão atual.

Implementação: `AssistenteDrawer` montado em `components/layout/app-shell.tsx`.

## Variáveis de ambiente

Reutiliza as mesmas chaves OpenAI do sandbox — **não** há `OPENAI_ASSISTENTE_*` separado
nem webhook n8n obrigatório.

| Variável | Uso |
|---|---|
| `OPENAI_API_KEY` | Obrigatória no servidor para o loop de chat/tools |
| `OPENAI_MODEL` | Opcional — modelo de chat (padrão `gpt-5.6-luna`) |
| `OPENAI_TRANSCRIBE_MODEL` | Opcional — Whisper (sandbox + anexos do assistente) |
| `CRON_SECRET` | Protege `GET/POST /api/cron/assistente` (header `x-cron-secret`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Cron de limpeza (service client) |

Helpers compartilhados: `getOpenAIApiKey` / `getOpenAIChatModel` em `lib/openai/sandbox.ts`.

## Tools

Cada tool devolve `{ ok, summary, links?, data? }` para a UI e o modelo.
Links do painel usam helpers em `lib/assistente/links.ts`:

| Recurso | Formato |
|---|---|
| Ficha (CPF) | `/clientes/{cpf}` |
| Ficha (telefone) | `/clientes/contato/{contact_norm}` |
| Pastas na ficha | `/clientes/...?pasta={geral\|caso:ID\|processo:ID\|custom:Nome}#arquivos` |
| Caso no kanban | `/kanban/{caso_id}` |
| Atendimento | `/atendimentos/{contact_norm}` |

### Leitura (sem confirmação)

| Tool | Função |
|---|---|
| `buscar_pessoas` | Busca global (nome, CPF, telefone, benefício) via `buscarGlobal` |
| `obter_ficha` | Ficha 360 por CPF e/ou telefone (`loadFichaPessoa`) + links ficha/pastas/kanban |
| `listar_casos` | Casos do funil (`casos_novos`), filtros CPF/telefone/status |
| `listar_prazos` | `app_prazos` (abertos, janela em dias, CPF) |
| `listar_conversa_resumo` | Últimas mensagens WhatsApp do contato |
| `resumo_atendimentos_hoje` | Conversas com mensagem **hoje** (America/Sao_Paulo): contagem + trecho por contato |

### Escrita (com confirmação na UI)

Lista em `WRITE_TOOL_NAMES` (`lib/assistente/write-tools.ts`). O modelo só **propõe**;
a mutação roda após Confirmar no drawer (`confirmarAcaoAssistente`).

| Tool | Intenção | Action |
|---|---|---|
| `enviar_whatsapp` | Mensagem ao cliente | `enviarMensagem` |
| `criar_prazo` | Novo prazo | `criarPrazo` |
| `mover_kanban` | Mudar status do funil | `updateCasoStatus` |
| `anexar_documento_ficha` | Mídia/doc na ficha (imagem, vídeo, PDF…) | `uploadArquivoCliente` / `registrarArquivoCliente` |
| `atualizar_caso` | Editar ficha do caso | `updateCasoFields` |
| `criar_cliente_caso` | Pessoa + caso no CRM (`nome` + `telefone` + `status` obrigatórios) | `criarClienteCaso` |

`criar_cliente_caso`: o prompt manda perguntar telefone WhatsApp e estágio do funil
(`CASO_STATUS`) antes de propor. Sem telefone/status a propose falha de propósito
(o CRM exige telefone).

Tools sensíveis devem respeitar `papel` (ex.: aprovações só advogado — fora desta lista
inicial).

## Anexos (composer)

O drawer aceita **imagem**, **vídeo** e **documento** (paperclip). Antes de enviar, o
usuário escolhe:

| Modo | Comportamento |
|---|---|
| **Interpretar** | Upload + preprocess OpenAI (vision em imagem; Whisper em áudio/vídeo se possível; extract em docs). O texto analisado entra no turno do modelo. Vídeo: tenta transcrever áudio; se falhar, mensagem clara (sem frames). |
| **Só salvar** | Upload **sem** vision/Whisper. O modelo recebe `url_media` e pede destino (cliente + pasta), depois propõe `anexar_documento_ficha` (confirmação na UI). |

A `url_media` fica em `app_assistente_sessoes.pending_anexo` até anexar com sucesso,
substituir o arquivo ou reiniciar a sessão — turnos seguintes re-injetam o bloco
`[ANEXO PENDENTE]` (não precisa reanexar).

`buscar_pessoas` devolve `match_count` + pessoas deduplicadas (nome/CPF/telefone):
1 → confirmar a única; 2+ → listar e escolher; 0 → criar cliente ou outro identificador.

Implementação: `lib/assistente/media.ts` + `enviarMensagemAssistente({ anexo })`.
Limites: 12 MB (interpretar) / 25 MB (só salvar).

## Modelo de confirmação

**Atual:** leitura executa na hora; escrita sempre retorna `requiresConfirmation` +
`confirmationId`. O drawer mostra card Confirmar / Cancelar; só após confirmar
`executeAssistenteWriteTool` roda. Auditoria grava `confirmed_by`.

Fluxo:

1. Modelo chama a write tool → `proposeAssistenteWriteTool` (sem mutar).
2. Drawer mostra `confirmationLabel` + botões Confirmar / Cancelar.
3. Confirmado → `confirmarAcaoAssistente` → server action → follow-up no chat + auditoria.
4. Cancelado → `cancelarAcaoAssistente` (sem mutar).

## Tabelas

Migration: `20260918150000_app_assistente.sql`.

| Tabela | Conteúdo |
|---|---|
| `app_assistente_sessoes` | `user_id`, `pending_anexo` (jsonb), `created_at`, `updated_at` |
| `app_assistente_mensagens` | `sessao_id`, `role`, `content`, `tool_trace`, `anexos` (cascade ao apagar sessão) |
| `app_assistente_auditoria` | `sessao_id`, `user_id`, `tool`, `args`, `result`, `confirmed_by`, `created_at` |

**RLS:** próprio usuário autenticado e ativo em `app_usuarios` (select/insert; sessões
também update/delete). `service_role` tem acesso total para o cron.

## Retenção (cron)

Endpoint: `GET` ou `POST` `/api/cron/assistente`

- Header `x-cron-secret: $CRON_SECRET` (ou query `?secret=` — mesmo padrão de
  `/api/cron/agente-sandbox`).
- Remove sessões com `updated_at` há mais de **30 dias** (mensagens em cascade).
- Remove linhas de auditoria com `created_at` há mais de 30 dias.
- Implementação: `lib/assistente/cleanup.ts` via service role.

Exemplo (crontab / Coolify Scheduled Task):

```bash
0 4 * * * curl -s -H "x-cron-secret: $CRON_SECRET" https://SEU-DOMINIO/api/cron/assistente
```

Resposta OK: `{ "ok": true, "sessoes": N, "auditoria": M }`.

## Fora de escopo (nesta entrega)

- Substituir o agente WhatsApp ou o sandbox de Configurações
- Acesso a Redis / `controlarIA` de clientes
- CRUD de usuários da equipe (login) — fase posterior
- Extração visual de frames de vídeo (só áudio via Whisper quando o container permitir)
