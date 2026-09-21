/**
 * Live smoke: assistente read + safe write tools against Supabase (service role).
 * Run: npx tsx --require ./scripts/register-smoke-live.cjs scripts/smoke-assistente-live.ts
 */
import { executeAssistenteTool } from "../lib/assistente/tools";
import {
  executeAssistenteWriteTool,
  proposeAssistenteWriteTool,
  resolveWriteArgs,
} from "../lib/assistente/write-tools";
import { createServiceClient } from "../lib/supabase/service";

type Row = { tool: string; ok: boolean; evidence: string };

const report: Row[] = [];

function logRow(tool: string, ok: boolean, evidence: string) {
  report.push({ tool, ok, evidence });
  console.log(ok ? "OK" : "FAIL", tool, "|", evidence.slice(0, 120));
}

async function runRead(tool: string, args: Record<string, unknown> = {}) {
  const r = await executeAssistenteTool(tool, args);
  logRow(tool, r.ok, r.summary ?? JSON.stringify(r.data)?.slice(0, 100) ?? "—");
  return r;
}

async function runWrite(
  tool: string,
  args: Record<string, unknown>,
  mode: "propose" | "execute"
) {
  const propose = await proposeAssistenteWriteTool(
    tool as Parameters<typeof proposeAssistenteWriteTool>[0],
    args
  );
  if (!propose.ok) {
    logRow(`${tool} (${mode})`, false, propose.summary ?? "propose failed");
    return propose;
  }
  if (mode === "propose") {
    logRow(`${tool} (propose)`, true, propose.summary ?? "confirmed");
    return propose;
  }
  const execArgs = resolveWriteArgs({
    args,
    result: propose,
  });
  const exec = await executeAssistenteWriteTool(
    tool as Parameters<typeof executeAssistenteWriteTool>[0],
    execArgs
  );
  logRow(`${tool} (execute)`, exec.ok, exec.summary ?? "—");
  return exec;
}

function spPrazoInMinutes(minutes: number): {
  data_prazo: string;
  hora_prazo: string;
} {
  const t = new Date(Date.now() + minutes * 60_000);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(t).map((p) => [p.type, p.value])
  );
  const data_prazo = `${parts.year}-${parts.month}-${parts.day}`;
  const hora_prazo = `${parts.hour}:${parts.minute}:00`;
  return { data_prazo, hora_prazo };
}

async function main() {
  const service = createServiceClient();

  const { data: mediaRow } = await service
    .from("documentos_cliente")
    .select("contact_norm, cpf, url_media, nome_documento")
    .not("url_media", "is", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: casoRow } = await service
    .from("casos_novos")
    .select("id, status, telefone, nome")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sampleContact =
    mediaRow?.contact_norm ??
    (casoRow?.telefone ? casoRow.telefone.replace(/\D/g, "") : "5598984868863");
  const sampleCpf = mediaRow?.cpf ?? undefined;

  // —— Reads ——
  await runRead("buscar_pessoas", { termo: "Maria" });
  await runRead("obter_ficha", {
    ...(sampleCpf ? { cpf: sampleCpf } : { contact_norm: sampleContact }),
  });
  await runRead("listar_casos", { limite: 5 });
  await runRead("listar_prazos", { limite: 5, apenas_abertos: true });
  await runRead("listar_conversa_resumo", {
    contact_norm: sampleContact,
    limite: 5,
  });
  await runRead("resumo_atendimentos_hoje", { limite: 10 });
  await runRead("ler_prompt_agente", { incluir_texto_completo: false });
  await runRead("ler_versoes_prompt_agente", { limite: 3 });

  // —— Writes ——
  await runWrite(
    "enviar_whatsapp",
    { texto: "Smoke — não enviar", telefone: "11999990000" },
    "propose"
  );

  const stamp = Date.now().toString().slice(-7);
  const cliente = await runWrite(
    "criar_cliente_caso",
    {
      nome: `Smoke Assistente ${stamp}`,
      telefone: `5599${stamp}`,
      status: "em_atendimento",
    },
    "execute"
  );
  let smokeCasoId: number | null = null;
  if (cliente.ok && cliente.data && typeof cliente.data === "object") {
    const d = cliente.data as { casoId?: number; caso_id?: number; id?: number };
    smokeCasoId = d.casoId ?? d.caso_id ?? d.id ?? null;
  }

  const prazoWhen = spPrazoInMinutes(8);
  await runWrite(
    "criar_prazo",
    {
      titulo: `Smoke prazo ${stamp}`,
      tipo: "outro",
      data_prazo: prazoWhen.data_prazo,
      hora_prazo: prazoWhen.hora_prazo,
      lembretes: [{ offset_minutes: 5, label: "5 minutos antes" }],
    },
    "execute"
  );

  const kanbanId = smokeCasoId ?? casoRow?.id;
  const statusOrig = casoRow?.status ?? "em_atendimento";
  if (kanbanId) {
    if (statusOrig !== "aguardando_analise") {
      await runWrite(
        "mover_kanban",
        { caso_id: kanbanId, status: "aguardando_analise" },
        "execute"
      );
      await runWrite(
        "mover_kanban",
        { caso_id: kanbanId, status: statusOrig },
        "execute"
      );
    } else {
      await runWrite(
        "mover_kanban",
        { caso_id: kanbanId, status: "em_atendimento" },
        "execute"
      );
      await runWrite(
        "mover_kanban",
        { caso_id: kanbanId, status: statusOrig },
        "execute"
      );
    }

    await runWrite(
      "atualizar_caso",
      {
        caso_id: kanbanId,
        pontos_analise_juridica: `smoke ${stamp}`,
      },
      "execute"
    );
  } else {
    logRow("mover_kanban (execute)", false, "sem caso_id");
    logRow("atualizar_caso (execute)", false, "sem caso_id");
  }

  if (mediaRow?.url_media) {
    await runWrite(
      "anexar_documento_ficha",
      {
        pasta: "geral",
        contact_norm: sampleContact,
        ...(sampleCpf ? { cpf: sampleCpf } : {}),
        url_media: mediaRow.url_media,
        nome_documento: `Smoke anexo ${stamp}`,
        mime_type: "image/jpeg",
      },
      "execute"
    );
  } else {
    logRow("anexar_documento_ficha (execute)", false, "sem mídia no banco");
  }

  const promptBefore = await runRead("ler_prompt_agente", {});
  const personaBefore =
    promptBefore.ok &&
    promptBefore.data &&
    typeof promptBefore.data === "object" &&
    "persona" in (promptBefore.data as object)
      ? String((promptBefore.data as { persona?: string }).persona ?? "")
      : "";

  if (personaBefore.includes("SMOKE_MARKER_ASSISTENTE")) {
    await runWrite(
      "propor_alteracao_prompt_agente",
      {
        modo: "substituir",
        ancora: "SMOKE_MARKER_ASSISTENTE",
        trecho_novo: "",
        motivo: "smoke cleanup",
      },
      "execute"
    );
  } else {
    const marker = `\n<!-- SMOKE_MARKER_ASSISTENTE ${stamp} -->\n`;
    const proposeAlt = await proposeAssistenteWriteTool(
      "propor_alteracao_prompt_agente",
      {
        modo: "inserir_apos",
        ancora: personaBefore.slice(0, 40) || "Sou",
        texto_inserir: marker,
        motivo: `smoke rascunho ${stamp}`,
      }
    );
    if (proposeAlt.ok) {
      const execArgs = resolveWriteArgs({ args: {}, result: proposeAlt });
      const execAlt = await executeAssistenteWriteTool(
        "propor_alteracao_prompt_agente",
        execArgs
      );
      logRow(
        "propor_alteracao_prompt_agente (execute)",
        execAlt.ok,
        execAlt.summary ?? "—"
      );
      if (execAlt.ok) {
        const execRestore = await executeAssistenteWriteTool(
          "propor_alteracao_prompt_agente",
          {
            persona: personaBefore,
            mensagem_abertura:
              (promptBefore.data as { mensagem_abertura?: string })
                ?.mensagem_abertura ?? "",
            motivo: "smoke restore rascunho",
          }
        );
        logRow(
          "propor_alteracao_prompt_agente (restore)",
          execRestore.ok,
          execRestore.summary ?? "—"
        );
      }
    } else {
      logRow(
        "propor_alteracao_prompt_agente (execute)",
        false,
        proposeAlt.summary ?? "propose failed"
      );
    }
  }

  const versoes = await executeAssistenteTool("ler_versoes_prompt_agente", {
    limite: 1,
  });
  const versaoId =
    versoes.ok &&
    Array.isArray((versoes.data as { versoes?: { id: string }[] })?.versoes)
      ? (versoes.data as { versoes: { id: string }[] }).versoes[0]?.id
      : Array.isArray(versoes.data)
        ? (versoes.data as { id: string }[])[0]?.id
        : undefined;

  if (versaoId) {
    await runWrite(
      "reverter_prompt_agente",
      { versao_id: versaoId, motivo: "smoke revert rascunho" },
      "execute"
    );
  } else {
    logRow("reverter_prompt_agente (execute)", false, "sem versao_id");
  }

  console.log("\n--- REPORT ---");
  for (const row of report) {
    console.log(`${row.ok ? "ok" : "FAIL"}\t${row.tool}\t${row.evidence.slice(0, 100)}`);
  }

  const fails = report.filter((r) => !r.ok);
  if (fails.length) {
    console.error(`\nLIVE SMOKE: ${fails.length} failure(s)`);
    process.exit(1);
  }
  console.log("\nLIVE SMOKE OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
