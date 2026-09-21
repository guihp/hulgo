# Aprovação pelo sistema — envio direto + despause da IA

## O que mudou

A decisão do advogado agora acontece **dentro do sistema** (`/aprovacoes/[id]`):

1. O advogado revisa o resumo da IA, pode **editar o texto** antes de enviar.
2. Ao clicar **Aprovar e enviar** (ou Responder manualmente / Recusar com aviso),
   **o próprio sistema envia a mensagem ao cliente via EvoGo** — não depende mais do n8n
   para o envio.
3. A decisão fica gravada em `aprovacoes_pendentes`:
   `status`, `resumo_final` / `resposta_manual` / `motivo_recusa`,
   `decidido_por`, `decidido_em`, `enviado_whatsapp`, `mensagem_id`.
4. Depois do envio, o sistema chama o webhook `N8N_WEBHOOK_APROVACAO` **apenas para
   DESPAUSAR a IA** (apagar o block no Redis que o subworkflow de aprovação criou).

O fluxo antigo pelo WhatsApp (`#aprovar` / `#responder` / `#recusar`) pode continuar
existindo em paralelo — mas o branch antigo **envia a mensagem**, então cuidado para não
usar os dois ao mesmo tempo na mesma pendência (o sistema só decide pendências com
status `pendente`, o que evita duplicidade se o n8n atualizar o status ao decidir).

## Payload que o sistema envia ao webhook

```json
{
  "id_aprovacao": 123,
  "acao": "aprovar",            // aprovar | responder | recusar
  "telefone": "559999999999@s.whatsapp.net",
  "instancia": "minha-instancia",
  "origem": "sistema",
  "mensagem_ja_enviada": true
}
```

Regra no n8n: **se `origem == "sistema"` e `mensagem_ja_enviada == true`, NÃO enviar
mensagem — só apagar o block do Redis** e responder 200.

## Fluxo n8n mínimo (importar `n8n-despause-aprovacao.json`)

```
Webhook (POST /despause-aprovacao)
  → Redis DEL  key = {{ telefone }}_block_{{ instancia }}
  → Respond to Webhook (200 {"ok": true})
```

Atenção à chave do block: o subworkflow de aprovação grava
`{Sender}_block_{instancia}` na credencial **Redis IAFE**, onde `Sender` é o JID
completo (`5599...@s.whatsapp.net`). O nó Redis do fluxo de despause usa o mesmo
formato e a MESMA credencial. Se sua instância usa o telefone sem `@s.whatsapp.net`
na chave, ajuste a expression do nó `DEL block`.

## Configuração no sistema

`.env.local`:

```
N8N_WEBHOOK_APROVACAO=https://SEU-N8N/webhook/despause-aprovacao
```

Sem essa env o sistema segue funcionando (envia a mensagem e grava a decisão), mas
mostra aviso de que o despause não foi confirmado — a IA continuaria pausada para
aquele cliente até o block expirar/ser removido manualmente.

## Teste ponta a ponta

1. Pelo WhatsApp, peça consulta de processo (IA cria pendência e pausa o cliente).
2. Abra `/aprovacoes` → pendência aparece em "Pendentes" (realtime).
3. Edite uma frase do resumo → **Aprovar com edição e enviar**.
4. Confira: cliente recebeu a mensagem; `aprovacoes_pendentes` tem `enviado_whatsapp=true`
   e `resumo_final` com o texto editado; conversa em `/atendimentos` mostra a mensagem.
5. Mande outra mensagem como cliente → IA deve responder (block removido).
