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

## 3. Reconsulta automática do DataJud

Na ficha do cliente, cada processo tem o seletor **"Monitoramento"** (desligado / 1 / 3 /
7 / 15 / 30 dias). Com o robô agendado:

- A cada execução, consulta os processos vencidos no DataJud.
- **Movimentação nova** → cria pendência na fila **/aprovacoes** com as últimas 5
  movimentações em linguagem simples. O advogado edita/aprova → sistema envia ao cliente.
- Sem novidade → só atualiza a data da última consulta.

### Agendar na VPS (quando subir o sistema)

`.env.local` (ou env do processo):

```
CRON_SECRET=um-segredo-forte-aqui
```

Crontab (`crontab -e`), todo dia às 8h:

```
0 8 * * * curl -s -H "x-cron-secret: SEU_SEGREDO" https://SEU-DOMINIO/api/cron/datajud > /dev/null
```

Enquanto o sistema roda só local, dá pra disparar manualmente:

```
curl -H "x-cron-secret: SEU_SEGREDO" http://localhost:3000/api/cron/datajud
```

A resposta é um relatório JSON: quantos processos monitorados e o que aconteceu com cada um.
