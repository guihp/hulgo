# n8n — Corrigir leitura de MÚLTIPLAS imagens (mensagens picadas)

## Diagnóstico

O debounce Redis (push → Wait 15s → get → If9) acumula **texto**, mas o **binário**
da imagem é lido de `$('Webhook EVO').item.json.body.data.Message.base64` — ou seja,
só existe na execução que sobreviveu ao `If9`. Quando o cliente manda 2 imagens:

1. Execução da imagem 1 morre no `If9` → base64 dela se perde.
2. Execução da imagem 2 vence → IA recebe 2 textos `[IMAGEM ENVIADA]` mas **1 binário**.
3. **Bug extra**: "Informar que é imagem" gera texto idêntico para toda imagem
   (`usuario enviou uma imagem`). O `If9` compara `propertyName.last() == message_content`
   → as DUAS execuções passam no teste → resposta duplicada / corrida no delete da key.
4. **Bug extra 2**: `<InfoUser>` só carrega o `conteudo_media` da última mídia →
   `registrar_documento_cliente` só consegue registrar 1 documento.

## Solução (recomendada): descrever cada imagem ANTES do Redis — igual ao fluxo de VÍDEO

O ramo de vídeo já funciona com múltiplos vídeos porque o `Analyze video` roda
**por execução, antes do push no Redis**. Basta fazer o mesmo com imagem, e embutir
a URL da mídia no texto para a IA registrar cada documento.

### Passo 1 — Trocar o ramo "image" do switch `verificar o caminho`

Hoje: `image → Informar que é imagem → Pegar a mensagem1`.

Novo encadeamento (espelhar o ramo de vídeo):

1. **Set "PEGAR BASE64 IMG"**
   - `data` = `{{ $('Webhook EVO').item.json.body.data.Message.base64 }}`
2. **Convert to File "Converter imagem"**
   - operation: `toBinary`, sourceProperty: `data`
3. **OpenAI "Analisar a imagem"** (nó já criado — gpt-5.1)
   - resource: `image`, operation: `analyze`
   - inputType: `base64` apontando para o campo `data` do passo 1
     (ou `binary` depois do Convert to File, como no fluxo de vídeo)
   - text (prompt) — colar inteiro:
     ```
     Você é um extrator de dados de documentos para um escritório de advocacia previdenciária (INSS). O cliente enviou esta imagem pelo WhatsApp. Analise e responda em português, EXATAMENTE neste formato:

     TIPO: <classifique: RG | CNH | CPF | Certidão de Nascimento | Certidão de Casamento | Certidão de Óbito | Certidão Eleitoral | Comprovante de Residência | CNIS | CTPS | Carnê de Contribuição | Laudo Médico | Atestado Médico | Exame | Receita Médica | Carta de Concessão/Indeferimento do INSS | DAP/CAF | Declaração de Sindicato | Nota Fiscal de Produtor Rural | Contrato | Procuração | Cartão do CadÚnico | Foto de Pessoa | Foto de Local/Atividade Rural | Print de Tela | Outro (especifique)>

     DADOS EXTRAÍDOS: transcreva TODOS os dados legíveis do documento, cada um em uma linha "Campo: valor". Priorize:
     - Nome completo de todas as pessoas citadas (titular, pai, mãe, cônjuge, falecido, médico)
     - CPF, RG, NIT/PIS, número de benefício (NB), número de processo
     - Datas: nascimento, casamento, óbito, emissão, atendimento, vínculos (admissão/saída)
     - Órgão emissor, cartório, cidade/UF
     - Em laudos/atestados: CID, diagnóstico por extenso, nome e CRM do médico, período de afastamento, se declara incapacidade
     - Em CNIS/CTPS: cada vínculo com empregador e período
     - Em documentos rurais (DAP/CAF, sindicato, notas): nome do agricultor, município, período/validade, atividade declarada
     - Em comprovante de residência: nome, endereço completo, mês de referência
     - Endereços e telefones visíveis

     QUALIDADE: <legível | parcialmente legível (diga o que não deu para ler) | ilegível | cortada | foto tremida>

     OBSERVAÇÕES: <detalhes úteis para o advogado: documento antigo, rasurado, assinado ou não, carimbo presente, verso ou frente, se é foto de pessoa/atividade rural descreva a cena (pessoa trabalhando na lavoura, ferramentas, animais etc.)>

     REGRAS:
     - Transcreva números EXATAMENTE como aparecem (com pontuação). NÃO invente, NÃO complete dígitos ilegíveis — escreva [ilegível] no lugar.
     - Se houver mais de um documento na mesma foto, liste cada um separadamente (TIPO 1, TIPO 2...).
     - Se não for documento (foto comum, meme, print de conversa), diga o que é e descreva brevemente.
     - Não dê opinião jurídica nem diga se o documento "serve" ou não.
     ```
   > **Erro conhecido**: com `gpt-5.1` o nó retorna
   > `400 — 'max_tokens' is not supported with this model. Use 'max_completion_tokens'`.
   > O nó (v1.6) manda `max_tokens` fixo e a família gpt-5 rejeita. Correções:
   > - **Simples**: trocar o modelo para `gpt-4o` ou `gpt-4.1` (aceitam `max_tokens`,
   >   têm visão, mais baratos). Em Options, subir "Length of Description (Max
   >   Tokens)" para ~2000 — o default 300 corta a extração.
   > - **Manter gpt-5.1**: substituir por HTTP Request → POST
   >   `https://api.openai.com/v1/chat/completions`, credencial OpenAI predefinida,
   >   body JSON:
   >   ```json
   >   {
   >     "model": "gpt-5.1",
   >     "max_completion_tokens": 2000,
   >     "messages": [
   >       { "role": "user", "content": [
   >         { "type": "text", "text": "PROMPT" },
   >         { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,{{ $json.data }}" } }
   >       ] }
   >     ]
   >   }
   >   ```
   >   Resposta em `choices[0].message.content`.
4. **Set "Format Response IMAGE"**
   - nó OpenAI: `content` = `{{ $json.content }}`
   - HTTP Request (gpt-5.1): `content` = `{{ $json.choices[0].message.content }}`
   - Google Gemini: `{{ $json.content.parts[0].text }}`
5. Conectar em **Pegar a mensagem1**.

> Por que este prompt: formato fixo TIPO/DADOS/QUALIDADE/OBSERVAÇÕES permite ao
> AI Agent1 usar o TIPO direto como `nome_documento` no registrar_documento_cliente;
> a regra do `[ilegível]` impede inventar dígito de CPF/NB; CID/CRM/vínculos CNIS
> são os dados que o advogado precisa para incapacidade e tempo de contribuição;
> cena rural descrita serve de início de prova material.

O nó "Informar que é imagem" pode ser deletado (ou deixado desconectado).

### Passo 2 — Atualizar o bloco de imagem no code do `Pegar a mensagem1`

Substituir o trecho:

```js
if (tipo === 'imageMessage' || $json.content) {
  return "[IMAGEM ENVIADA]: [DESCRIÇÃO DA IMAGEM ENVIADA]: " + $json.content;
}
```

por:

```js
if (tipo === 'imageMessage' || $json.content) {
  let url = '';
  try {
    url = $('Adicionar mídia do cliente no banco').first().json.conteudo_media || '';
  } catch (e) {}
  return "[IMAGEM ENVIADA] [URL_MEDIA]: " + url +
         " [DESCRIÇÃO]: " + $json.content;
}
```

Agora cada imagem entra no Redis com **descrição própria + URL própria** —
o texto vira único (conserta também o bug do `If9` com imagens idênticas) e a IA
tem a URL de CADA documento.

### Passo 3 — Desligar o passthrough de binário (If4)

Com as descrições no texto, o binário da última imagem vira redundância que
confunde (IA vê 1 binário + N descrições). Duas opções:

- **Simples**: editar o `If4` para nunca ser true (ex.: condição `1 == 2`) —
  tudo flui por `Juntar mensagens` input 1, sem binário.
- Ou deletar `If4 → PEGAR A BASE → Converte o arquivo1` e ligar `Config`
  direto no input 1 do `Juntar mensagens`.

O `passthroughBinaryImages: true` no AI Agent pode ficar (não faz nada sem binário).

### Passo 4 — Ajuste no prompt do AI Agent1 (`<documentos-cliente>`)

Adicionar no início do bloco `<documentos-cliente>`:

```
A mensagem do cliente pode conter VÁRIOS blocos no formato
"[IMAGEM ENVIADA] [URL_MEDIA]: <url> [DESCRIÇÃO]: <descrição>".
Cada bloco é UM documento distinto: chame registrar_documento_cliente UMA VEZ
POR BLOCO, usando a [URL_MEDIA] daquele bloco como url_media (NÃO use a URL do
<InfoUser> quando houver blocos com URL própria). Identifique o tipo pelo texto
da [DESCRIÇÃO].
```

## Hardening opcional do debounce (If9)

O `If9` compara o ÚLTIMO item da lista com o texto atual — quebra sempre que o
cliente manda duas mensagens de texto idênticas ("ok", "ok"). Padrão mais robusto:

1. Após o push no Redis, **SET** em key separada:
   `{{telefone}}_{{instancia}}_lastid` = `{{ $('mapear_dados').first().json.id_message }}`
2. Após o Wait 15s, **GET** dessa key e comparar com o próprio `id_message`.
   Só a execução da última mensagem (ID único do WhatsApp) prossegue — sem falso
   positivo por texto repetido.

## Alternativa descartada (registrada por completude)

Guardar o base64 de cada imagem numa segunda lista Redis
(`{{telefone}}_{{instancia}}_media`) e, na execução vencedora, converter cada item
em binário (`data0`, `data1`, ...) num Code node — o `passthroughBinaryImages`
envia todos os binários de imagem ao modelo. Funciona, mas: base64 de foto de
celular tem 1–5 MB por item no Redis, código de remontagem frágil, e o modelo
recebe N imagens numa chamada só (mais caro). A opção por descrição é mais
barata, mais estável e resolve também o registro de documentos por URL.
