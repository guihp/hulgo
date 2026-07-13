import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { consultarDataJud } from "@/lib/datajud";
import { phoneToContactNorm } from "@/lib/utils/phone";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Reconsulta automática do DataJud.
 * Agendar na VPS (crontab) — ver docs/RECONSULTA-E-ASSINATURA.md:
 *   0 8 * * * curl -s -H "x-cron-secret: $CRON_SECRET" https://SEU-DOMINIO/api/cron/datajud
 * Processos com monitorar_dias vencido são consultados; movimentação NOVA vira
 * pendência na fila /aprovacoes para o advogado revisar e enviar ao cliente.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const provided =
    req.headers.get("x-cron-secret") ??
    req.nextUrl.searchParams.get("secret") ??
    "";
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();

  const { data: processos, error } = await service
    .from("processos_clientes")
    .select(
      "id, nome, cpf, telefone, numero_processo, monitorar_dias, ultima_consulta_datajud, ultimo_movimento"
    )
    .eq("ativo", true)
    .not("monitorar_dias", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: configInstancia } = await service
    .from("app_config")
    .select("valor")
    .eq("chave", "whatsapp_instancia")
    .maybeSingle();
  const instancia =
    configInstancia?.valor?.trim() || process.env.EVOGO_INSTANCE_NAME || null;

  const agora = Date.now();
  const relatorio: Record<string, string>[] = [];

  for (const p of processos ?? []) {
    const dias = p.monitorar_dias ?? 0;
    const ultima = p.ultima_consulta_datajud
      ? new Date(p.ultima_consulta_datajud).getTime()
      : 0;
    const vencido = agora - ultima >= dias * 24 * 60 * 60 * 1000;
    if (!vencido) {
      relatorio.push({ processo: p.numero_processo, resultado: "ainda no prazo" });
      continue;
    }

    const consulta = await consultarDataJud(p.numero_processo);

    // Evita rajada de 429 na API pública do CNJ
    await new Promise((r) => setTimeout(r, 2500));

    await service
      .from("processos_clientes")
      .update({ ultima_consulta_datajud: new Date().toISOString() })
      .eq("id", p.id);

    if (!consulta.encontrado) {
      relatorio.push({ processo: p.numero_processo, resultado: consulta.motivo });
      continue;
    }

    const topo = consulta.movimentos[0];
    const chaveMovimento = topo ? `${topo.data}|${topo.nome}` : null;

    if (!chaveMovimento || chaveMovimento === p.ultimo_movimento) {
      relatorio.push({
        processo: p.numero_processo,
        resultado: "sem movimentação nova",
      });
      continue;
    }

    // Movimentação nova → pendência na fila de aprovações
    const ultimas = consulta.movimentos
      .slice(0, 5)
      .map((m) => {
        const d = m.data ? new Date(m.data) : null;
        const dataFmt =
          d && !Number.isNaN(d.getTime())
            ? d.toLocaleDateString("pt-BR")
            : "";
        return `• ${dataFmt} — ${m.nome}${m.complemento ? ` (${m.complemento})` : ""}`;
      })
      .join("\n");

    const resumo =
      `🔎 Atualização automática do processo ${p.numero_processo} (${consulta.tribunal}).\n\n` +
      `Últimas movimentações:\n${ultimas}\n\n` +
      `Revise e edite este texto antes de aprovar o envio ao cliente.`;

    const telefone = phoneToContactNorm(p.telefone);
    if (!telefone) {
      relatorio.push({
        processo: p.numero_processo,
        resultado: "movimentação nova, mas processo sem telefone — pendência não criada",
      });
      continue;
    }

    const { error: insErr } = await service.from("aprovacoes_pendentes").insert({
      telefone_cliente: telefone,
      nome_cliente: p.nome,
      cpf: p.cpf,
      numero_processo: p.numero_processo,
      resumo,
      instancia,
      status: "pendente",
    });

    if (insErr) {
      relatorio.push({ processo: p.numero_processo, resultado: `erro: ${insErr.message}` });
      continue;
    }

    await service
      .from("processos_clientes")
      .update({ ultimo_movimento: chaveMovimento })
      .eq("id", p.id);

    relatorio.push({
      processo: p.numero_processo,
      resultado: "movimentação nova → pendência criada na fila de aprovações",
    });
  }

  return NextResponse.json({
    ok: true,
    monitorados: processos?.length ?? 0,
    relatorio,
  });
}

export const POST = GET;
