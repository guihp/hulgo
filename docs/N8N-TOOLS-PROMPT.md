# n8n — Tools da IA + Prompt (organizador WhatsApp, fase 1)

Substitua `SEU-DOMINIO` pela URL do painel (ex.: `https://painel.seudominio.com` ou ngrok em dev).  
Substitua `SEU_TOKEN` pelo valor de `N8N_INTEGRACAO_TOKEN` no `.env` do servidor Next.js (ou `app_config.n8n_integracao_token` no Supabase).

**Prompt completo** para colar no AI Agent1: **[PROMPT-AGENTE-IA.md](./PROMPT-AGENTE-IA.md)**

**Headers comuns (tools HTTP do painel):**
```
x-integracao-token: SEU_TOKEN
Content-Type: application/json
```

---

## Tool 1 — `consultar_cliente_kanban`

**Quando usar:** no início da conversa, ao retomar contato, ou antes de mover o cliente — para saber em qual coluna do funil ele está.

| Campo | Valor |
|-------|--------|
| **Name** | `consultar_cliente_kanban` |
| **Type** | HTTP Request Tool |
| **Method** | POST |
| **URL** | `https://SEU-DOMINIO/api/integracao/kanban-consultar` |

**Description (cole no nó):**
```
Consulta em qual coluna do funil Kanban o cliente está no painel do escritório. Use no início da conversa, ao retomar um contato, ou ANTES de chamar mover_cliente_kanban para não mover desnecessariamente. Retorna: coluna (nome legível), status (código), nome, CPF, benefício identificado, documentos recebidos e faltantes. Se encontrado=false, o cliente ainda não está no funil (será criado ao cadastrar em dados_cliente_testehulgo).
```

**Body JSON (modo expressão `=`):**
```json
={
  "telefone_cliente": "{{ $('mapear_dados').first().json.telefone }}"
}
```

---

## Tool 2 — `mover_cliente_kanban`

**Quando usar:** quando a intenção do cliente mudar ou ficar clara — não a cada mensagem. Ao concluir a organização → `aguardando_analise` (mensagem fixa automática se ainda não enviada).

| Campo | Valor |
|-------|--------|
| **Name** | `mover_cliente_kanban` |
| **Type** | HTTP Request Tool |
| **Method** | POST |
| **URL** | `https://SEU-DOMINIO/api/integracao/kanban-mover` |

**Description (cole no nó):**
```
Move o cliente para outra coluna do funil Kanban. Chame APENAS quando a intenção mudar ou ficar clara — não a cada mensagem. Antes de mover, prefira consultar_cliente_kanban. Colunas (campo coluna): em_atendimento = cliente novo ou intenção indefinida; consultar_processo = quer andamento (ainda organizando); abertura_processo = benefício novo ainda coletando docs; aguardando_analise = organização concluída / caixa de pendências da equipe (destino padrão fase 1 — dispara mensagem fixa automática); aguardando_aprovacao = fase 2 aprovação de texto (não usar na fase 1); atendimento_humano = pediu falar com advogado; processo_finalizado = caso encerrado. Sempre informe motivo curto.
```

**Body JSON (modo expressão `=`):**
```json
={
  "telefone_cliente": "{{ $('mapear_dados').first().json.telefone }}",
  "coluna": {{ $fromAI('coluna', 'Status do funil: em_atendimento | consultar_processo | abertura_processo | aguardando_analise | aguardando_aprovacao | atendimento_humano | processo_finalizado', 'string') }},
  "motivo": {{ $fromAI('motivo', 'Breve motivo da movimentação, 1 frase', 'string') }},
  "nome_cliente": {{ $fromAI('nome_cliente', 'Nome do cliente se já informado', 'string') }}
}
```

---

## Tool 3 — `buscar_processos_por_cpf`

**Type:** Postgres Tool (já existente no agente)

**Description (fase 1):**
```
Busca na base interna do escritório se há processos vinculados a um CPF. Use só para localizar cadastro quando o cliente pedir andamento. NÃO revele número de processo, movimentação nem dados sensíveis ao cliente nesta fase — encaminhe para aguardando_analise. Se retornar vazio, o CPF não está cadastrado.
```

---

## Tool 4 — `consultar_processo_datajud` (fora do prompt — fase 2)

**Type:** Tool Workflow (pode permanecer no workflow **desconectada** do Agent nesta fase)

Não instruir o Agent a usar nesta fase.

---

## Tool 5 — `enviar_para_aprovacao_advogado` (fora do prompt — fase 2)

**Type:** Tool Workflow (pode permanecer **desconectada** nesta fase)

Não instruir o Agent a usar nesta fase. Em fase 2: após aprovação de resumo → `mover_cliente_kanban` com `aguardando_aprovacao`.

---

## Tool 6 — `registrar_caso_para_advogado`

**Type:** Tool Workflow (já existente)

**Description (fase 1):**
```
Use no FINAL da organização (CPF + demanda + checklist informado / docs registrados). Grava o caso na fila do escritório. Em seguida chame mover_cliente_kanban com coluna aguardando_analise. Relatório curto e factual — sem pontos_analise_juridica obrigatórios nesta fase. Chame só uma vez por caso.
```

**Subfluxo recomendado (mensagem fixa):** ver seção em [PROMPT-AGENTE-IA.md](./PROMPT-AGENTE-IA.md). Preferência: deixar o `kanban-mover` enviar a mensagem (flag anti-duplicata). Se o subfluxo enviar via EvoGo sendText antes do mover, grave `mensagem_encaminhamento_enviada_em`.

Texto fixo:

> Recebemos suas informações. Sua solicitação foi encaminhada para análise. Aguarde, que em breve retornaremos com a resposta.

---

## Tool 7 — `registrar_documento_cliente`

**Type:** HTTP Request Tool

| Campo | Valor |
|-------|--------|
| **Name** | `registrar_documento_cliente` |
| **Method** | POST |
| **URL** | `https://SEU-DOMINIO/api/integracao/documento-registrar` |

**Description:**
```
Use quando o cliente enviar foto ou PDF e você identificar qual documento é (RG, CPF, certidão, laudo, etc.). Envia a URL da mídia já salva no sistema (conteudo_media do ingest), o nome do documento e uma descrição curta. Atualiza automaticamente o que o cliente já enviou e o que ainda falta no caso. Chame assim que identificar o documento — não espere o fim da organização. Não avalie se o documento é válido.
```

**Body JSON (modo expressão `=`):**
```json
={
  "nome_documento": {{ $fromAI('nome_documento', 'Nome do documento identificado, ex: RG, CPF, Certidão de óbito', 'string') }},
  "descricao": {{ $fromAI('descricao', 'Descrição curta do que foi enviado', 'string') }},
  "url_media": {{ $fromAI('url_media', 'URL pública da mídia (conteudo_media do ingest)', 'string') }},
  "telefone_cliente": "{{ $('mapear_dados').first().json.telefone }}",
  "nome_cliente": {{ $fromAI('nome_cliente', 'Nome do cliente se já informado', 'string') }},
  "cpf": {{ $fromAI('cpf', 'CPF do cliente se já informado, senão vazio', 'string') }},
  "mensagem_id": "{{ $('mapear_dados').first().json.id_message }}"
}
```

---

## Tool 8 — `atualizar_dados_caso`

Preenche a ficha do caso incrementalmente (CPF, benefício, docs faltantes, etc.). Ver [CONTROLE-IA-E-DADOS-CASO.md](./CONTROLE-IA-E-DADOS-CASO.md).

---

# Blocos de prompt (resumo)

Cole o systemMessage completo de **[PROMPT-AGENTE-IA.md](./PROMPT-AGENTE-IA.md)**. Trechos-chave:

```
<funil-kanban>
...
- aguardando_analise → Aguardando análise (destino padrão após organização)
...
5. Fim da organização → SEMPRE mover para aguardando_analise.
</funil-kanban>
```

Checklist de documentos: espelhar `lib/utils/beneficios.ts` (bloco `<checklist-documentos>` no prompt).

Fluxo fase 1:

- **Organização:** saudação → CPF → demanda → checklist → `atualizar_dados_caso` / `registrar_documento_cliente` → `registrar_caso_para_advogado` → `mover_cliente_kanban` `aguardando_analise`
- **Falar com advogado:** `atendimento_humano`
- **Não usar nesta fase:** DataJud, `enviar_para_aprovacao_advogado`, `aguardando_aprovacao`

---

## Checklist n8n

- [ ] `consultar_cliente_kanban` ligada ao AI Agent (ai_tool)
- [ ] `mover_cliente_kanban` ligada ao AI Agent
- [ ] `registrar_documento_cliente` ligada ao AI Agent
- [ ] `atualizar_dados_caso` ligada ao AI Agent
- [ ] `registrar_caso_para_advogado` ligada ao AI Agent
- [ ] `buscar_processos_por_cpf` ligada (só localizar cadastro)
- [ ] DataJud / aprovação desconectadas do Agent (fase 1)
- [ ] Header `x-integracao-token` nas HTTP tools do painel
- [ ] systemMessage = [PROMPT-AGENTE-IA.md](./PROMPT-AGENTE-IA.md)
