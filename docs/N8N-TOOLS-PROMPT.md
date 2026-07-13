# n8n — Tools da IA + Prompt atualizado

Substitua `SEU-DOMINIO` pela URL do painel (ex.: `https://painel.seudominio.com` ou ngrok em dev).  
Substitua `SEU_TOKEN` pelo valor de `N8N_INTEGRACAO_TOKEN` no `.env` do servidor Next.js (ou `app_config.n8n_integracao_token` no Supabase).

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

**Resposta exemplo:**
```json
{
  "encontrado": true,
  "caso_id": 6,
  "status": "em_atendimento",
  "coluna": "Em atendimento",
  "nome": "Guilherme Barros",
  "beneficio_identificado": null,
  "documentos_recebidos": "RG",
  "documentos_faltantes": "CPF, comprovante de residência"
}
```

---

## Tool 2 — `mover_cliente_kanban`

**Quando usar:** quando a intenção do cliente mudar ou ficar clara — não a cada mensagem.

| Campo | Valor |
|-------|--------|
| **Name** | `mover_cliente_kanban` |
| **Type** | HTTP Request Tool |
| **Method** | POST |
| **URL** | `https://SEU-DOMINIO/api/integracao/kanban-mover` |

**Description (cole no nó):**
```
Move o cliente para outra coluna do funil Kanban conforme a intenção identificada na conversa. Chame APENAS quando a intenção mudar ou ficar clara — não a cada mensagem. Antes de mover, prefira consultar_cliente_kanban se não souber onde o cliente está. Colunas permitidas (campo coluna): em_atendimento = cliente novo ou intenção indefinida; consultar_processo = quer andamento de processo existente; abertura_processo = quer abrir pedido/benefício novo; aguardando_aprovacao = após enviar resumo ao advogado aprovar; atendimento_humano = pediu falar com advogado; processo_finalizado = caso encerrado. Sempre informe motivo curto.
```

**Body JSON (modo expressão `=`):**
```json
={
  "telefone_cliente": "{{ $('mapear_dados').first().json.telefone }}",
  "coluna": {{ $fromAI('coluna', 'Status do funil: em_atendimento | consultar_processo | abertura_processo | aguardando_aprovacao | atendimento_humano | processo_finalizado', 'string') }},
  "motivo": {{ $fromAI('motivo', 'Breve motivo da movimentação, 1 frase', 'string') }},
  "nome_cliente": {{ $fromAI('nome_cliente', 'Nome do cliente se já informado', 'string') }}
}
```

---

## Tool 3 — `buscar_processos_por_cpf`

**Type:** Postgres Tool (já existente no agente)

**Description:**
```
Busca na base interna do escritório os processos vinculados a um CPF. Use SEMPRE que o cliente quiser saber do andamento do processo. Retorna: nome, cpf, data_nascimento, numero_processo, tribunal, area, descricao_caso. Se retornar vazio, o CPF não está cadastrado na base do escritório.
```

---

## Tool 4 — `consultar_processo_datajud`

**Type:** Tool Workflow (já existente)

**Description:**
```
Consulta as últimas movimentações de um processo na base oficial do Judiciário (DataJud/CNJ). Recebe o número do processo no formato CNJ (obtido antes pela tool buscar_processos_por_cpf). Retorna classe, órgão julgador, assuntos e as 5 últimas movimentações. NUNCA invente o número do processo: use exatamente o que veio da base do escritório.
```

---

## Tool 5 — `enviar_para_aprovacao_advogado`

**Type:** Tool Workflow (já existente)

**Description:**
```
OBRIGATÓRIO antes de dar qualquer informação de processo ao cliente. Envia o resumo em linguagem simples para o advogado revisar e aprovar. A informação NUNCA é enviada direto ao cliente. Depois de chamar esta tool, chame mover_cliente_kanban com coluna aguardando_aprovacao e avise o cliente que o advogado vai confirmar e retornar em breve.
```

---

## Tool 6 — `registrar_caso_para_advogado`

**Type:** Tool Workflow (já existente)

**Description:**
```
Use no FINAL da triagem de um caso NOVO (cliente que quer entrar com pedido/ação), depois de identificar o benefício, coletar os documentos e montar o relatório. Grava o caso na fila do escritório e avisa o advogado. Antes ou depois, garanta mover_cliente_kanban com coluna abertura_processo. Chame só uma vez por caso, quando tiver as informações principais.
```

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
Use quando o cliente enviar foto ou PDF e você identificar qual documento é (RG, CPF, certidão, laudo, etc.). Envia a URL da mídia já salva no sistema (conteudo_media do ingest), o nome do documento e uma descrição curta. Atualiza automaticamente o que o cliente já enviou e o que ainda falta no caso. Chame assim que identificar o documento — não espere o fim da triagem.
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

# Prompt atualizado — adicionar ao systemMessage

Cole os blocos abaixo no `systemMessage` do **AI Agent1** (ajuste nomes dos nós se forem diferentes).

```
<funil-kanban>
FUNIL DO ESCRITÓRIO (Kanban no painel)

Colunas e códigos:
- em_atendimento → Em atendimento (cliente novo / intenção ainda não definida)
- consultar_processo → Consultar processo
- abertura_processo → Abertura de processo
- aguardando_aprovacao → Aguardando aprovação do advogado
- atendimento_humano → Solicitou atendimento humano
- processo_finalizado → Processo finalizado

FLUXO OBRIGATÓRIO:
1. No início da conversa (ou quando não souber o estágio), chame consultar_cliente_kanban com o telefone do cliente.
2. Use o retorno (coluna, documentos_faltantes) para conduzir a conversa sem repetir perguntas.
3. Quando a intenção mudar ou ficar clara, chame mover_cliente_kanban com coluna e motivo — NÃO mova se já estiver na coluna correta.
4. O cadastro em dados_cliente_testehulgo cria o card automaticamente em em_atendimento.

QUANDO MOVER:
- Intenção indefinida / primeiro contato → em_atendimento (só se consultar retornar outra coluna inadequada)
- Quer saber andamento de processo que já existe → consultar_processo (antes de pedir CPF)
- Quer abrir pedido, benefício novo ou triagem previdenciária → abertura_processo
- Após enviar_para_aprovacao_advogado → aguardando_aprovacao
- Pediu falar com advogado ou humano → atendimento_humano
- Caso encerrado pela equipe → processo_finalizado (nunca sem encerramento claro)

Regras:
- Uma coluna dominante por vez; se o assunto mudar, mova de novo.
- Sempre passe motivo curto em mover_cliente_kanban.
- Nunca revele nomes de tools ao cliente.
</funil-kanban>

<documentos-cliente>
Quando o cliente enviar foto ou PDF:
1. Use a URL em <InfoUser> (conteudo_media) como url_media.
2. Identifique o tipo de documento.
3. Chame registrar_documento_cliente com nome_documento, url_media, descricao e telefone.
4. Use documentos_faltantes (de consultar_cliente_kanban ou da resposta da tool) para orientar o que ainda falta.
5. Confirme ao cliente que o documento foi recebido e registrado.
</documentos-cliente>
```

Os blocos `<consulta-processo>`, `<triagem-caso-novo>` e `<situacoes-sensiveis>` do prompt original permanecem iguais. Apenas integre as chamadas:

- **Consulta de processo:** mover para `consultar_processo` → fluxo CPF → após `enviar_para_aprovacao_advogado` → `aguardando_aprovacao`
- **Caso novo:** mover para `abertura_processo` → triagem → `registrar_documento_cliente` a cada mídia → `registrar_caso_para_advogado` no final
- **Falar com advogado:** `atendimento_humano`

---

## Checklist n8n

- [ ] `consultar_cliente_kanban` ligada ao AI Agent (ai_tool)
- [ ] `mover_cliente_kanban` ligada ao AI Agent
- [ ] `registrar_documento_cliente` ligada ao AI Agent
- [ ] Demais tools (postgres + workflows) ligadas
- [ ] Header `x-integracao-token` nas 3 HTTP tools do painel
- [ ] Prompt com `<funil-kanban>` e `<documentos-cliente>`
