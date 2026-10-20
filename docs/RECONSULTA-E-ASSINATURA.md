# Ficha do advogado, documentos com assinatura e reconsulta automática

## 1. O advogado agora gerencia tudo do caso

- **Editar dados** (caso no Kanban): botão novo ao lado de "Novo prazo" — edita TODOS os
  campos da ficha (nome, CPF, nascimento, benefício, área, tipo de segurado, negativa,
  requisitos, pontos de análise…). O que a IA preencher depois não apaga o que você
  digitou — e vice-versa (a tool `atualizar_dados_caso` só completa campos).
- **Adicionar processo do cliente**: já existia — página **/clientes → "Novo processo"**
  (também edita/exclui). É essa base que a tool `buscar_processos_por_cpf` da IA consulta
  quando o cliente pede andamento. Do caso, o botão "Marcar processo finalizado" também
  cria o processo automaticamente.

## 2. Documentos do escritório + assinatura do cliente

No caso (Kanban) há o cartão **"Documentos do escritório"**:

1. **Subir documento** (PDF/imagem) — ex.: contrato de honorários, procuração. Marque
   **"Precisa da assinatura do cliente"** se for o caso.
2. **Enviar ao cliente**: manda o arquivo + mensagem pelo WhatsApp na hora (pelo próprio
   sistema, sem depender da IA). A mensagem vem pré-pronta e é editável.
3. Se precisa assinatura: o item **"<documento> assinado"** entra nos
   `documentos_faltantes` do caso → **a IA passa a cobrar** o cliente e, quando ele
   mandar a foto/PDF assinado, a tool `registrar_documento_cliente` reconhece e move para
   recebidos (fluxo que já existe).
4. Badges de estado: *precisa assinar* → *aguardando assinatura* → *assinado*. Botão
   **"Marcar assinado"** resolve manualmente se preciso.

O envio de documento **não pausa a IA** (ela precisa continuar ativa pra receber a
devolução). Mensagem manual no chat de atendimentos continua pausando.

### Bloco opcional para o systemMessage (deixa a IA mais esperta na cobrança)

```
<documento-para-assinar>
Se em documentos_faltantes houver item terminando em "assinado" (ex.: "Contrato de
honorários assinado"), significa que o escritório enviou um documento para o cliente
assinar e devolver por foto/PDF aqui no WhatsApp. Se o cliente perguntar sobre isso,
oriente: assinar, tirar foto legível (ou escanear) e enviar nesta conversa. Quando o
documento assinado chegar, registre com registrar_documento_cliente usando o MESMO nome
do item faltante.
</documento-para-assinar>
```

## 3. Consulta automática do DataJud (CNJ)

Desde 20/10/2026 **todos os processos ativos com nº CNJ** são consultados automaticamente,
uma vez por dia (não precisa mais ligar processo por processo). Controle em
**Configurações → Consulta na Justiça**:

- **Consultar os processos automaticamente** (padrão: ligado).
- **Criar pendência em Aprovações quando houver movimentação nova** (padrão: desligado,
  para não encher a fila). Ligado: a pendência traz as últimas 5 movimentações e o advogado
  edita/aprova → o sistema envia ao cliente.
- Números: processos com nº CNJ, consultados nas últimas 24 h, ainda não consultados,
  novidades nos últimos 7 dias, não achados na base. Botão **Consultar agora** dispara uma
  rodada em segundo plano.

O que muda nas telas:

- A última movimentação do CNJ fica em colunas próprias (`datajud_mov_data`,
  `datajud_mov_texto`; `datajud_mov_chave` é a chave interna de comparação) e aparece no
  card do processo ("Na Justiça · data", com a marca **nova** por 7 dias), na ficha e no
  relatório PDF. **O "Último andamento" escrito pela equipe não é alterado.**
- A primeira consulta de cada processo só grava o ponto de partida; "nova" só aparece
  quando a movimentação muda depois disso.
- Na ficha (aba DataJud), o seletor por processo virou intervalo: todo dia (padrão) /
  3 / 7 / 15 / 30 dias / **Não consultar este processo** (`monitorar_dias = 0`).
  "Consultar agora" na ficha também grava a movimentação no processo.
- Falha passageira do CNJ (limite, fora do ar, demora) não marca o processo como
  consultado: ele entra de novo na próxima execução.

Limitações: a base pública do CNJ atrasa alguns dias em relação ao site do tribunal, não
mostra processos em segredo de justiça e não inclui requerimentos administrativos do INSS.

### Agendar (Coolify ou crontab)

Env `CRON_SECRET` no container. Agendar **de hora em hora** — a consulta vai em lotes de
20 processos por tribunal; se o CNJ estiver lento ou recusar, o que sobrar fica para a
próxima execução:

```
0 * * * * curl -s -m 320 -H "x-cron-secret: SEU_SEGREDO" https://SEU-DOMINIO/api/cron/datajud > /dev/null
```

Disparo manual local:

```
curl -H "x-cron-secret: SEU_SEGREDO" http://localhost:3000/api/cron/datajud
```

A resposta é um relatório JSON: consultados, novidades, não encontrados, falhas, restantes e
o resultado de cada processo.
