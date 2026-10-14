# IA do WhatsApp no sistema (sem n8n)

O atendimento automático roda no próprio Next. O fluxo `[Hulgo] IA Atendimento` do n8n
deixa de ser usado quando a EvoGo passa a mandar o webhook para cá.

## Fluxo

```
EvoGo ─► /api/whatsapp/webhook?token=…      (responde 200 na hora)
           ├─ grava mensagem + mídia (mensagens / bucket mensagens-media)
           ├─ IsFromMe (advogado no celular) → pausa a IA do cliente
           ├─ grupo do advogado: #aprovar / #responder / #recusar
           ├─ "/reset" de número de teste → apaga a memória
           └─ app_ia_fila (processar_apos = agora + debounce)
                       │ after() no webhook  +  cron /api/cron/ia-whatsapp (1 min)
                       ▼
     lib/ia-whatsapp/processar.ts
       mídia → ia_conteudo (áudio/vídeo transcritos, imagem/documento com o extrator jurídico)
       histórico (mensagens desde o último /reset) → agente (Responses API, reasoning high)
       → ferramentas (mesmas 9 do n8n) → divide em mensagens → EvoGo → app_ia_execucoes
```

| Arquivo | Papel |
|---|---|
| `lib/ia-whatsapp/evogo-payload.ts` | Webhook EvoGo → mensagem normalizada (inclui @lid) |
| `lib/ia-whatsapp/ingest.ts` | Grava mensagem/mídia (substitui mensagem-ingest/media-ingest) |
| `lib/ia-whatsapp/midia.ts` | Como a IA lê cada mensagem; link do Maps / localização |
| `lib/ia-whatsapp/ferramentas.ts` | Tools do agente, chamando RPCs/funções direto |
| `lib/ia-whatsapp/agente.ts` | Loop de tool-calling |
| `lib/ia-whatsapp/prompt.ts` | Persona de `app_agente_config` (troca as expressões `{{ }}` do n8n) |
| `lib/ia-whatsapp/advogado.ts` | Comandos no grupo do advogado |
| `lib/ia-whatsapp/estado.ts` | Pausa/despausa (antes era Redis); `controlarIA()` usa isto |

## Tabelas

- `app_ia_whatsapp_config` — modo (`desligado` · `teste` · `publico`), números de teste,
  grupo/números do advogado, espera (debounce), token do webhook.
- `app_ia_estado` — pausa por telefone, memória desde, última mensagem respondida.
- `app_ia_fila` — debounce com `FOR UPDATE SKIP LOCKED` (RPCs `ia_fila_*`).
- `app_ia_execucoes` — log de cada resposta (60 dias). Página `/ia-whatsapp`.

## Colocar no ar

1. Coolify → variáveis:
   - `EVOGO_WEBHOOK_URL` = URL mostrada em **/ia-whatsapp → Conexão com a EvoGo**
   - `APP_URL` = `https://advocacia.iafeoficial.com` (links mandados ao advogado)
   - opcional `LOCATIONIQ_API_KEY` (endereço de localização/link do Maps)
   - opcional `IA_WHATSAPP_REASONING` (`high` padrão)
2. Redeploy e, em Configurações → WhatsApp, reconectar (o connect regrava o webhook).
3. Scheduled Task a cada minuto:
   `curl -s -H "x-cron-secret: $CRON_SECRET" https://SEU-DOMINIO/api/cron/ia-whatsapp`
4. Desativar o fluxo n8n (senão ele também responderia, se ainda recebesse o webhook).

## Testar local sem mandar WhatsApp

`EVOGO_DRY_RUN=1` faz todo `/send/*` só aparecer no log do servidor. Use um telefone
fictício nos números de teste e apague os dados depois (mensagens, app_ia_*, casos_novos,
documentos_cliente, aprovacoes_pendentes, arquivos em `mensagens-media/{telefone}/`).
