# Controle da IA (pausar/despausar) + tool `atualizar_dados_caso`

## 1. Tool nova: `atualizar_dados_caso` (preenche a ficha do caso)

**Problema:** os campos do detalhe do caso no Kanban (nome, CPF, benefício, tipo de
segurado, requisitos…) ficavam vazios porque a IA só gravava tudo no FIM da triagem via
`registrar_caso_para_advogado`. Agora existe uma tool incremental.

**Backend já no ar** (nada a fazer no Supabase):
- RPC `atualizar_dados_caso` — atualiza só os campos enviados, nunca apaga o que já existe;
  acha o caso pelo telefone (cria em `em_atendimento` se não existir).
- Edge Function `caso-atualizar` — `https://hzfvciamevimjzuvidcp.supabase.co/functions/v1/caso-atualizar`

**No n8n:**
1. Importe/cole os nós de `n8n-tool-atualizar-dados-caso.json` no canvas.
2. Nos headers do nó, troque `COLE_AQUI_A_SERVICE_ROLE_KEY` pela mesma service role key
   usada nas tools `kanban-mover` / `documento-cliente-registrar`.
3. Conecte o nó como **ai_tool** do `AI Agent1` (o JSON já traz a conexão).

**Bloco para adicionar no systemMessage do AI Agent1** (dentro de `<funil-kanban>` ou logo após):

```
<ficha-do-caso>
Sempre que descobrir um dado novo do cliente na conversa (nome, CPF, data de nascimento,
benefício desejado, área, tipo de segurado, negativa do INSS e motivo, se já tem processo,
se já recebe benefício, requisitos preenchidos/pendentes, pontos de análise jurídica,
benefícios alternativos), chame atualizar_dados_caso IMEDIATAMENTE com apenas os campos
novos — não espere o fim da triagem. Os campos não enviados ficam como estão; nada é
apagado. Isso mantém a ficha do caso no painel do advogado sempre atualizada.
</ficha-do-caso>
```

**Teste:** mande "meu nome é João da Silva, CPF 111.222.333-44" → abra o caso no Kanban →
Nome e CPF preenchidos.

## 2. Pausar a IA quando o advogado responde pelo sistema

**Problema:** mensagem manual enviada em `/atendimentos` não pausava a IA — cliente
respondia e a IA atropelava o advogado.

**Como ficou:** toda mensagem enviada pelo sistema (chat de atendimentos) agora chama o
webhook do n8n com `{ acao: "pausar", telefone, instancia }`, que grava o block no Redis —
o mesmo block que o seu fluxo já verifica antes de responder. A decisão de aprovação
continua chamando `acao: "despausar"` depois de enviar (não pausa a si mesma).

**No n8n:** importe `n8n-controle-ia.json` (substitui o antigo `despause-aprovacao`):

```
Webhook POST /controle-ia
  → Switch body.acao
      pausar    → Redis SET  {telefone}_block_{instancia} = true
      despausar → Redis DEL  {telefone}_block_{instancia}
  → Responder 200
```

Confira a credencial **Redis IAFE** no import e **ative o workflow**.

**No sistema (`.env.local`):**

```
N8N_WEBHOOK_CONTROLE_IA=https://SEU-N8N/webhook/controle-ia
```

(o antigo `N8N_WEBHOOK_APROVACAO` funciona como fallback se preferir manter um só)

**Payloads enviados pelo sistema** (telefone sempre só dígitos, ex. `5519981941604`):

```json
{ "acao": "pausar",    "telefone": "5519981941604", "instancia": "testehulgo", "origem": "sistema" }
{ "acao": "despausar", "telefone": "5519981941604", "instancia": "testehulgo", "origem": "sistema",
  "id_aprovacao": 12, "acao_aprovacao": "aprovar", "mensagem_ja_enviada": true }
```

### ⚠️ Correções no SEU fluxo principal (chaves do block inconsistentes)

O block só funciona se TODOS os nós usarem a MESMA chave. Padrão adotado:
`{telefone_só_dígitos}_block_{instancia}` (igual ao `mapear_dados.telefone`).

Hoje seu fluxo tem 3 formatos diferentes — ajuste 2 nós:

1. **`Verifica Atendimento Humano1`** (entrada) usa `Info.Sender` (vem com
   `@s.whatsapp.net`). Troque a key para:
   `{{ $('Webhook EVO').item.json.body.data.Info.Chat.split('@')[0] }}_block_{{ $('mapeamento de dados').first().json.instancia }}`

2. **`PARAR a IA2`** usa `Info.RecipientAlt` — **esse campo costuma vir VAZIO** (veja seu
   próprio pinData: `"RecipientAlt": ""`), então a chave virava `_block_...` e nunca
   pausava nada. Troque a key para:
   `{{ $('Webhook EVO').item.json.body.data.Info.Chat.split('@')[0] }}_block_{{ $('mapeamento de dados').first().json.instancia }}`

3. **`Verifica Atendimento Humano`** (saída) já usa `mapear_dados.telefone` (dígitos) — ok.
4. **`Liberar IA do cliente`** usa `telefone_cliente` da pendência (dígitos) — ok.

Com isso: advogado responde pelo celular (IsFromMe) OU pelo sistema → IA pausa.
Aprovação decidida no sistema → IA despausa. Tudo na mesma chave.

**Sugestão:** o block não tem TTL. Se quiser que a pausa expire sozinha (ex. 24h), no nó
`SET block (pausar)` marque a opção de expiração/TTL do nó Redis (86400s).

## 3. Teste ponta a ponta

1. Cliente manda mensagem → IA responde normal.
2. Advogado responde pelo sistema em `/atendimentos` → toast confirma envio; no Redis
   existe `5519..._block_testehulgo`.
3. Cliente manda outra mensagem → IA fica MUDA (block ativo).
4. Advogado decide uma aprovação no sistema → block removido → IA volta a responder.
