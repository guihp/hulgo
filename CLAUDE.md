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
- **IA organizadora (fase 1)**: coluna Kanban `aguardando_analise` ("Aguardando análise") = caixa
  de pendências após organização WhatsApp (CPF + demanda + checklist). Mensagem fixa ao entrar
  (`lib/casos/encaminhamento-analise.ts` + flag `casos_novos.mensagem_encaminhamento_enviada_em`);
  painel e `POST /api/integracao/kanban-mover`. Prompt: `docs/PROMPT-AGENTE-IA.md`. Migration:
  `20260806180000_aguardando_analise_encaminhamento.sql`.
- **Pastas na ficha** (2026-08-12): arquivos saíram do menu. Hub é a ficha (`/clientes/[cpf]`
  ou `/clientes/contato/[fone]`). `documentos_cliente` ganhou `cpf`, `contact_norm`,
  `processo_id`, `pasta` (`geral` | `caso:{id}` | `processo:{id}` | `custom:{nome}`);
  `caso_id` nullable; tabela `documentos_pastas`. Upload na ficha:
  `uploadArquivoCliente` / `criarPastaCliente`. `/arquivos` redireciona. Migration:
  `20260812120000_documentos_pastas_ficha.sql`.
- **Erros mapeados** (2026-10-09): `instrumentation.ts` (onRequestError) grava todo erro de servidor em
  `app_erros_log` (digest, rota, mensagem, `mensagem_usuario` traduzida por `lib/erros.ts`). No cliente,
  use `toastErroAcao`/`mensagemErro` de `lib/client/erros.ts` — quando a produção só devolve o código,
  o toast busca o motivo em `/api/erros/{digest}`. `app/(app)/error.tsx` faz o mesmo para páginas.
  Para investigar um código que a cliente mandar: `select * from app_erros_log where digest = '...'`.
- **Processo sem número**: `processos_clientes.numero_processo` é nullable; checkbox "Ainda sem número"
  no formulário, badge + "Adicionar nº" no card (`definirNumeroProcesso`), filtro "Sem número".
  Assistente também cadastra sem número. DataJud ignora os sem número.
- **Pagamentos** (`/pagamentos`): `app_prazos` com `tipo='pagamento'` + `valor_centavos`; some de /prazos;
  "Marcar pago"; pagos não entram na limpeza de 30 dias. Rótulos de push em `lib/prazos/rotulos.ts`.
- Assistente: limite de mensagem subiu de 8.000 para 30.000 caracteres (`ASSISTENTE_MENSAGEM_MAX`).
- **IA do WhatsApp no sistema** (2026-10-13): substitui o fluxo n8n. Webhook EvoGo em
  `/api/whatsapp/webhook?token=` → `lib/ia-whatsapp/*` (fila com debounce, agente com as 9 tools,
  comandos #aprovar no grupo). Página `/ia-whatsapp` (modo desligado/teste/público, números de teste,
  pausas, log). Pausa da IA agora em `app_ia_estado` (sem Redis). Detalhes: `docs/IA-WHATSAPP.md`.
  Teste local: `EVOGO_DRY_RUN=1` não envia WhatsApp. Corrigida a RPC `atualizar_dados_caso` (array_append).
- **Chave/modelos da OpenAI no painel** (2026-10-14): Configurações → Inteligência artificial. Chave cifrada
  (AES-256-GCM, `lib/crypto/segredos.ts`, senha mestra = env `APP_ENCRYPTION_KEY`) em `app_ia_credenciais`
  (RLS sem policies: só service_role). Nunca volta ao navegador (só os 4 últimos). Leitura central em
  `lib/openai/credenciais.ts` (painel → fallback envs `OPENAI_*`); `getOpenAIApiKey/ChatModel` agora são async.
- **Atendimentos estilo WhatsApp** (2026-10-20): lista vem da RPC `listar_conversas` (última msg por contato,
  não lidas por usuário — resposta da equipe conta como leitura, a da IA `session_id='ia'` não —, pausa da IA,
  foto, etiquetas); abre no fim, faixa "N não lidas", botão ↓, Esc fecha, "Marcar como não lida"
  (`app_conversas_lidas.nao_lida`). Botão da IA mostra o estado real (modo geral/teste/pausa).
  **Etiquetas**: `app_etiquetas` + `app_conversa_etiquetas` (`lib/actions/etiquetas.ts`, filtro na lista).
  **Foto de perfil**: webhook → `lib/ia-whatsapp/foto-perfil.ts` (EvoGo `/user/avatar` só com JID
  `@s.whatsapp.net` — com número puro trava), copiada para `mensagens-media/avatars/`, 7 dias de validade.
  Migration: `20261020120000_atendimentos_etiquetas_fotos.sql`. Base UI: `DropdownMenuLabel` precisa de
  `DropdownMenuGroup` em volta (senão a página quebra). Dev com CSS velho: apagar `.next/dev/cache`.
- **IA × atendimento humano** (2026-10-20): etiquetas automáticas `app_etiquetas.chave` = `ia_atendendo` /
  `atendimento_humano` (`lib/ia-whatsapp/etiquetas-atendimento.ts`, não editáveis). `pausarIA` → "Atendimento humano";
  `despausarIA` tira a etiqueta e avança `ultima_mensagem_id` (a IA espera o cliente escrever); a IA responder →
  "IA atendendo". Tool `mover_cliente_kanban` com `atendimento_humano` avisa o grupo e pausa DEPOIS de mandar a
  resposta do turno (`efeitos.transferidoParaHumano`). Memória = tabela `mensagens`: mensagens da equipe entram no
  histórico com prefixo "[Mensagem da equipe…]" (IA = `session_id='ia'`); mídias do cliente sem leitura (IA pausada)
  são lidas ao voltar. Modo teste continua só para os números de teste.
- **Funil → processo**: `processos_clientes.caso_id`. A equipe mover o card para `abertura_processo`
  (`updateCasoStatusCliente`) cria o processo sem número ligado ao caso (a IA mover NÃO cria). Botões em
  `components/processos/vincular-processo.tsx` (painel "Processo" no caso, botão "Processo" na conversa,
  "Veio do funil" no card do processo). Processo novo cadastrado à mão liga ao caso do mesmo CPF/telefone.
  Migration: `20261020150000_atendimento_ia_humano_processo_caso.sql`.
- **Relatório PDF por parceiro + DataJud automático** (2026-10-20): `?parceiro=<id>|sem` em
  `/api/processos/relatorio` (botão "Por parceiro…" e tool do assistente). Robô `/api/cron/datajud`
  consulta TODOS os processos ativos com nº CNJ 1x/dia, em lotes de 20 por tribunal
  (`consultarDataJudLote`, `lib/datajud-monitor.ts`); agendar de hora em hora. Movimentação do CNJ vai
  para `datajud_mov_data/texto/chave` (+ `datajud_novidade_em`, `datajud_resultado`) — **não sobrescreve
  `ultimo_movimento`** da equipe. Card/ficha/PDF mostram "Na Justiça". `monitorar_dias`: null = todo dia,
  0 = não consultar. Configurações → Consulta na Justiça (`app_config` `datajud_auto`, `datajud_pendencias`
  — pendência em Aprovações desligada por padrão). Migration `20261020180000_datajud_automatico.sql`.
- **IAs consultam a Justiça na hora** (2026-10-20): assistente tem a tool `consultar_andamento_justica`
  (processo_id | numero_processo | cpf, até 3 processos) e a IA do WhatsApp usa `consultar_processo_datajud`;
  ambas via `consultarAoVivoERegistrar` (`lib/datajud-monitor.ts`: 3 tentativas de 40 s, grava no processo) e
  devolvem `ja_estava_no_sistema` + resultado de agora (falha → "CNJ lento"). WhatsApp avisa o cliente "estou
  consultando…" 1x por atendimento (`efeitos.avisoConsultaJustica`). `listar_processos`/`buscar_processos_por_cpf`
  trazem a movimentação do CNJ salva. Chat do assistente mostra "Consultando a Justiça…" enquanto espera.
- **Card no funil na 1ª mensagem** (2026-10-21): o webhook chama a RPC `garantir_caso_contato` (trava por
  telefone, sem duplicar) e todo contato novo vira card "Em atendimento" com o nome do WhatsApp — antes o card
  só nascia quando a IA registrava o caso. Números de teste e da equipe (`numeros_advogado`) ficam de fora;
  `registrar_caso` da IA atualiza esse mesmo card. Migration `20261021090000_caso_na_primeira_mensagem.sql`.
