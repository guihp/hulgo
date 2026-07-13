@AGENTS.md

## Módulos adicionados em 2026-07-10 (sessão Claude)

- **/aprovacoes reformada**: realtime, urgência por idade, filtros/busca, histórico
  paginado. Detalhe com contexto (links ficha/conversa/funil/aprovações anteriores),
  **resumo editável + preview WhatsApp**, recusa com motivo, trilha de decisão.
- **Aprovação envia direto pelo sistema** via EvoGo (`lib/actions/aprovacoes.ts` →
  `decidirAprovacao`), grava `resumo_final/resposta_manual/motivo_recusa/decidido_por/
  decidido_em/enviado_whatsapp/mensagem_id` e chama `N8N_WEBHOOK_APROVACAO` **só para
  despausar a IA** (payload com `origem:"sistema", mensagem_ja_enviada:true`).
  Fluxo n8n pronto: `docs/n8n-despause-aprovacao.json` + `docs/APROVACAO-SISTEMA.md`.
- **Prazos** (`app_prazos`, RLS authenticated): página /prazos, widget "próximos 7 dias"
  no dashboard, badge na sidebar, botão nos casos e na ficha do cliente.
- **DataJud** (`lib/datajud.ts`): consulta por nº CNJ (TRF1-6, TJs, TRTs) na ficha do
  cliente. Chave pública embutida; override via env `DATAJUD_API_KEY`.
- **Checklist de documentos por benefício** (`lib/utils/beneficios.ts`): botão "Aplicar
  checklist" no caso adiciona docs do template a `documentos_faltantes`; checkbox move
  para recebidos (serialização compatível com RPC `registrar_documento_cliente`).
- **Sinalizador de requisito etário** no caso (rural 55/60, urbana 62/65, BPC 65).
- **Geração de documentos** em `/documentos/[tipo]?caso=ID` (procuração, honorários,
  hipossuficiência) — layout print próprio em `app/(print)/`, campos editáveis, window.print.
- **Busca global ⌘K** no header (`lib/actions/busca.ts`).
- Migration aplicada no Supabase: `20260710200000_aprovacoes_decisao_prazos.sql`
  (colunas de decisão + `app_prazos` + realtime publication).
- UI kit é **Base UI** (não Radix): triggers usam `render`/`className`, NÃO `asChild`.
- **Tool IA `atualizar_dados_caso`**: RPC + Edge Function `caso-atualizar` (deployada) preenchem
  a ficha do caso incrementalmente pelo telefone. n8n: `docs/n8n-tool-atualizar-dados-caso.json`
  + bloco de prompt em `docs/CONTROLE-IA-E-DADOS-CASO.md`.
- **Ficha do caso editável**: `EditarCasoDialog` (kanban) — advogado edita todos os campos;
  `updateCasoFields` aceita a ficha inteira.
- **Documentos do escritório** (`lib/actions/documentos.ts` + `DocsAdvogado`): upload
  (bucket mensagens-media, origem='advogado'), envio ao cliente via EvoGo sendMedia (não
  pausa IA), fluxo assinatura ("X assinado" entra em documentos_faltantes → IA cobra;
  registrar_documento_cliente resolve; badge/marcar assinado).
- **Reconsulta automática DataJud**: `processos_clientes.monitorar_dias` (seletor no
 DataJudPanel) + rota `/api/cron/datajud` (header `x-cron-secret` = env `CRON_SECRET`);
 movimentação nova cria pendência em aprovacoes_pendentes. Crontab da VPS ou Scheduled
 Task no Coolify — ver `docs/RECONSULTA-E-ASSINATURA.md` e `docs/DEPLOY-COOLIFY.md`.
- **Notificações**: `NotificationsProvider` (realtime: mensagens INSERT tipo≠bot, casos_novos
  UPDATE status — exige REPLICA IDENTITY FULL, documentos_cliente INSERT origem≠advogado,
  aprovacoes INSERT) + `NotificationsBell` no header (toast + blip WebAudio + Notification API).
  Não-lidas por conversa: `app_conversas_lidas` (RLS por usuário) + `marcarConversaLida`;
  badge verde estilo WhatsApp em `groupConversations(readMap)`.
- **Datas defensivas**: `lib/utils/dates.ts` tolera datas inválidas/formatos DataJud
  (`yyyyMMddHHmmss`) — retorna "—" em vez de crashar.
- **Controle IA**: `lib/n8n.ts` → `controlarIA('pausar'|'despausar')`. `enviarMensagem` pausa a IA
  por padrão (`pausarIA: false` p/ desligar — aprovação usa isso e despausa depois). Env:
  `N8N_WEBHOOK_CONTROLE_IA` (fallback `N8N_WEBHOOK_APROVACAO`). Fluxo: `docs/n8n-controle-ia.json`.
  Chave block padrão: `{telefone_digitos}_block_{instancia}` — nós de entrada do fluxo principal
  (Verifica Atendimento Humano1 / PARAR a IA2) precisavam de correção (RecipientAlt vazio).
