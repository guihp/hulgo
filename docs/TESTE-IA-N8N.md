# Testar agente → webhook n8n

O sandbox em **Configurações → Testar agente** pré-processa mídia no Next.js
(Whisper / visão / extração de documento) e envia um JSON ao fluxo n8n.
A resposta final do agente vem do nó **Respond to Webhook**.

## Env

```
N8N_WEBHOOK_TESTE_IA=https://n8n-sgo8ksokg404ocg8sgc4sooc.vemprajogo.com/webhook/teste-ia-hulgoo
```

Sem a env, o sistema usa essa URL como padrão.

## Fluxo mínimo

```
Webhook (POST teste-ia-hulgoo, responseMode: responseNode)
  → AI Agent
  → Respond to Webhook
```

## Payload (exemplo)

```json
{
  "prompt": "Você é a assistente do escritório…",
  "mensagem": "Quais documentos preciso?",
  "tipo": "texto",
  "audio_transcrito": null,
  "imagem_descricao": null,
  "documento_transcrito": null,
  "historico": [
    { "role": "user", "content": "Oi" },
    { "role": "assistant", "content": "Olá! Como posso ajudar?" }
  ],
  "sessao_id": "uuid",
  "versao_prompt": "rascunho",
  "tipo_caso": "Aposentadoria rural"
}
```

`tipo`: `texto` | `audio` | `imagem` | `documento`.

## AI Agent — expressions

- **System message:** `{{ $json.prompt }}`
- **User / text (chat input):** combine the preprocessed fields, e.g.

```
={{
  [
    $json.mensagem,
    $json.audio_transcrito ? ('[Áudio transcrito]: ' + $json.audio_transcrito) : '',
    $json.imagem_descricao ? ('[Descrição da imagem]: ' + $json.imagem_descricao) : '',
    $json.documento_transcrito ? ('[Documento]: ' + $json.documento_transcrito) : ''
  ].filter(Boolean).join('\n\n')
}}
```

Optional: map `historico` into memory / previous messages if the Agent node supports it.

## Respond to Webhook

Return JSON the app can parse, preferably:

```json
{ "output": "texto da resposta do agente" }
```

Also accepted: `{ "text": "..." }`, plain string, or nested `data` / langchain shapes.
