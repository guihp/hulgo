import { after, NextResponse } from "next/server";
import { tratarComandoAdvogado, ehComandoAdvogado } from "@/lib/ia-whatsapp/advogado";
import { ehAdvogado, getIaConfig, iaAtendeTelefone, ehNumeroDeTeste } from "@/lib/ia-whatsapp/config";
import { foiEnviadoPeloSistema, enviarTextoCliente } from "@/lib/ia-whatsapp/enviar";
import { pausarIA, resetarNumeroTeste } from "@/lib/ia-whatsapp/estado";
import { atualizarFotoPerfil } from "@/lib/ia-whatsapp/foto-perfil";
import { parseEvogoWebhook } from "@/lib/ia-whatsapp/evogo-payload";
import { salvarMensagemRecebida } from "@/lib/ia-whatsapp/ingest";
import { processarFilaIA } from "@/lib/ia-whatsapp/processar";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Webhook da EvoGo → IA do WhatsApp no sistema.
 * URL: /api/whatsapp/webhook?token=<app_ia_whatsapp_config.webhook_token>
 */
export async function POST(req: Request) {
  const config = await getIaConfig();
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token || token !== config.webhook_token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const msg = parseEvogoWebhook(body);
  if (!msg || msg.tipo === "ignorar" || !msg.id) return NextResponse.json({ ok: true, ignorada: true });

  // Grupos: só o do advogado interessa (#aprovar / #responder / #recusar).
  if (msg.ehGrupo) {
    if (
      msg.chat === config.grupo_advogado &&
      msg.tipo === "text" &&
      ehComandoAdvogado(msg.texto) &&
      ehAdvogado(config, msg.remetente) &&
      !foiEnviadoPeloSistema(msg.id)
    ) {
      after(() => tratarComandoAdvogado(msg, config));
      return NextResponse.json({ ok: true, comando: true });
    }
    return NextResponse.json({ ok: true, grupo: true });
  }
  if (!msg.telefone) return NextResponse.json({ ok: true, ignorada: true });

  await salvarMensagemRecebida(msg);
  after(() => atualizarFotoPerfil(msg.telefone, msg.jid));

  if (msg.doEscritorio) {
    // Advogado respondeu pelo celular → IA pausa para este cliente.
    if (!foiEnviadoPeloSistema(msg.id)) await pausarIA(msg.telefone, "advogado_celular");
    return NextResponse.json({ ok: true });
  }

  const supabase = createServiceClient();
  await supabase.from("app_ia_estado").upsert(
    { telefone: msg.telefone, nome_contato: msg.nome || null, updated_at: new Date().toISOString() },
    { onConflict: "telefone" }
  );

  // Contato novo vira card "Em atendimento" no Funil de vendas já na 1ª mensagem
  // (números de teste e da equipe ficam de fora; a IA cria o deles ao registrar o caso).
  if (!ehNumeroDeTeste(config, msg.telefone) && !ehAdvogado(config, msg.telefone)) {
    const { error } = await supabase.rpc("garantir_caso_contato", {
      p_telefone: msg.telefone,
      p_nome: msg.nome || undefined,
    });
    if (error) console.error("[webhook] garantir_caso_contato", error.message);
  }

  if (msg.tipo === "text" && msg.texto.trim() === "/reset" && ehNumeroDeTeste(config, msg.telefone)) {
    await resetarNumeroTeste(msg.telefone);
    await enviarTextoCliente({
      telefone: msg.telefone,
      texto: "Resetado, pronto para testes. (Memória zerada, card sem CPF/dados, processos e parceiro desvinculados, IA ligada.)",
      instancia: msg.instancia,
    });
    return NextResponse.json({ ok: true, reset: true });
  }

  if (!iaAtendeTelefone(config, msg.telefone)) return NextResponse.json({ ok: true, ia: false });

  await supabase.rpc("ia_fila_agendar", {
    p_telefone: msg.telefone,
    p_instancia: msg.instancia,
    p_segundos: config.debounce_segundos,
  });

  after(async () => {
    await new Promise((r) => setTimeout(r, (config.debounce_segundos + 1) * 1000));
    await processarFilaIA();
  });

  return NextResponse.json({ ok: true, agendada: true });
}
