import { NextRequest, NextResponse } from "next/server";
import { emitPainelPush } from "@/lib/push";
import { CASO_STATUS } from "@/lib/constants";
import { formatPrazoDateTime } from "@/lib/prazos/lembretes";
import { formatPhone } from "@/lib/utils/phone";
import { fichaPessoaHref } from "@/lib/utils/ficha";

export const dynamic = "force-dynamic";

type WebhookBody = {
  type?: string;
  table?: string;
  schema?: string;
  record?: Record<string, unknown> | null;
  old_record?: Record<string, unknown> | null;
};

function statusLabel(status: string | null | undefined) {
  return CASO_STATUS.find((s) => s.value === status)?.label ?? status ?? "—";
}

function authorize(req: NextRequest): boolean {
  const secret = process.env.PUSH_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  const provided =
    req.headers.get("x-push-webhook-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ??
    req.nextUrl.searchParams.get("secret") ??
    "";
  return provided === secret;
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = (await req.json()) as WebhookBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const table = body.table ?? "";
  const type = (body.type ?? "").toUpperCase();
  const record = body.record ?? null;
  const old = body.old_record ?? null;

  if (!record) {
    return NextResponse.json({ ok: true, skipped: "sem record" });
  }

  try {
    if (table === "mensagens" && type === "INSERT") {
      const msgType = String(record.type ?? "");
      if (msgType === "bot") {
        return NextResponse.json({ ok: true, skipped: "bot" });
      }
      const contact = String(record.contact_norm ?? "");
      const phone = String(record.phone ?? contact);
      const bruto = String(record.text ?? "").replace(
        /^\[MENSAGEM DE TEXTO ENVIADA\]:\s*/i,
        ""
      );
      const semParenteses =
        bruto.startsWith("(") && bruto.endsWith(")")
          ? bruto.slice(1, -1)
          : bruto;
      const texto =
        semParenteses || (record.conteudo_media ? "[mídia]" : "");
      const result = await emitPainelPush({
        kind: "mensagem",
        title: `💬 ${formatPhone(phone)}`,
        body: String(texto).slice(0, 120),
        href: `/atendimentos?contact=${encodeURIComponent(contact)}`,
        tag: `msg-${record.id ?? contact}-${Date.now()}`,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (table === "casos_novos" && type === "INSERT") {
      const id = Number(record.id);
      const nome = (record.nome as string | null) ?? null;
      const telefone = (record.telefone as string | null) ?? null;
      const status = (record.status as string | null) ?? "em_atendimento";
      const result = await emitPainelPush({
        kind: "kanban",
        title: "🆕 Novo lead no funil",
        body: `${nome ?? formatPhone(telefone ?? "")} entrou em ${statusLabel(status)}`,
        href: fichaPessoaHref({
          contactNorm: telefone,
          aba: "caso",
          casoId: id,
        }),
        tag: `caso-new-${id}`,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (table === "casos_novos" && type === "UPDATE") {
      const id = Number(record.id);
      const statusNovo = String(record.status ?? "em_atendimento");
      const statusAntigo = old ? String(old.status ?? "") : "";
      if (!statusAntigo || statusAntigo === statusNovo) {
        return NextResponse.json({ ok: true, skipped: "status inalterado" });
      }
      const nome = (record.nome as string | null) ?? null;
      const telefone = (record.telefone as string | null) ?? null;
      const quem = nome ?? formatPhone(telefone ?? "");

      if (statusNovo === "atendimento_humano") {
        const result = await emitPainelPush({
          kind: "transferencia",
          title: "🙋 Cliente pediu atendimento humano",
          body: `${quem} está aguardando o advogado`,
          href: `/atendimentos?contact=${encodeURIComponent(
            (telefone ?? "").replace(/\D/g, "")
          )}`,
          tag: `caso-hum-${id}`,
        });
        return NextResponse.json({ ok: true, ...result });
      }

      const result = await emitPainelPush({
        kind: "kanban",
        title: "📋 Caso movido no funil",
        body: `${quem}: ${statusLabel(statusAntigo)} → ${statusLabel(statusNovo)}`,
        href: fichaPessoaHref({
          contactNorm: telefone,
          aba: "caso",
          casoId: id,
        }),
        tag: `caso-mov-${id}-${statusNovo}`,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (table === "documentos_cliente" && type === "INSERT") {
      if (String(record.origem ?? "") === "advogado") {
        return NextResponse.json({ ok: true, skipped: "advogado" });
      }
      const casoId = record.caso_id != null ? Number(record.caso_id) : null;
      const cpf = (record.cpf as string | null) ?? null;
      const contactNorm = (record.contact_norm as string | null) ?? null;
      const href =
        cpf || contactNorm
          ? fichaPessoaHref({ cpf, contactNorm, aba: "arquivos" })
          : casoId
            ? `/kanban/${casoId}`
            : "/clientes";
      const result = await emitPainelPush({
        kind: "documento",
        title: "📎 Documento recebido",
        body: String(record.nome_documento ?? "Documento"),
        href,
        tag: `doc-${record.id ?? Date.now()}`,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    // INSERT de qualquer origem (n8n, painel/kanban, DataJud cron, assistente).
    // Sem filtros de status/origem — todo registro novo gera push.
    if (table === "aprovacoes_pendentes" && type === "INSERT") {
      const id = Number(record.id);
      const nome =
        (record.nome_cliente as string | null)?.trim() ||
        formatPhone(String(record.telefone_cliente ?? ""));
      const result = await emitPainelPush({
        kind: "aprovacao",
        title: "✅ Nova aprovação pendente",
        body: `${nome || "Cliente"} aguardando sua revisão`,
        href: Number.isFinite(id) && id > 0 ? `/aprovacoes/${id}` : "/aprovacoes",
        tag: `aprov-${id || Date.now()}`,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (table === "app_prazos" && type === "INSERT") {
      const id = Number(record.id);
      const titulo = String(record.titulo ?? "Prazo");
      const dataPrazo = String(record.data_prazo ?? "");
      const horaPrazo =
        record.hora_prazo != null ? String(record.hora_prazo) : null;
      const quando = dataPrazo
        ? formatPrazoDateTime(dataPrazo, horaPrazo)
        : "";
      const isAudiencia = record.tipo === "audiencia";
      const result = await emitPainelPush({
        kind: "prazo",
        title: isAudiencia ? "⚖️ Nova audiência" : "📅 Novo prazo",
        body: quando ? `${titulo} — ${quando}` : titulo,
        href: isAudiencia ? "/audiencias" : "/prazos",
        tag: `prazo-${id || Date.now()}`,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({
      ok: true,
      skipped: `ignorado ${table}/${type}`,
    });
  } catch (err) {
    console.error("[push/webhook]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro" },
      { status: 500 }
    );
  }
}
