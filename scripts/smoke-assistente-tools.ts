/**
 * One-off smoke: schemas + propose/reject for write tools (no live WhatsApp/DB mutate).
 * Run: npx tsx --require ./scripts/register-stubs.cjs scripts/smoke-assistente-tools.ts
 */
import {
  ASSISTENTE_TOOL_DEFINITIONS,
  executeAssistenteTool,
} from "../lib/assistente/tools";
import {
  WRITE_TOOL_NAMES,
  proposeAssistenteWriteTool,
  isWriteTool,
} from "../lib/assistente/write-tools";
import {
  classifyAssistenteAnexo,
  isAllowedAssistenteMime,
} from "../lib/assistente/media";

async function main() {
  const expectedRead = [
    "buscar_pessoas",
    "obter_ficha",
    "listar_casos",
    "listar_prazos",
    "listar_conversa_resumo",
    "resumo_atendimentos_hoje",
    "ler_prompt_agente",
    "ler_versoes_prompt_agente",
  ];
  const names = ASSISTENTE_TOOL_DEFINITIONS.map(
    (d) => d.function.name
  ) as string[];
  const expected = [...expectedRead, ...WRITE_TOOL_NAMES] as string[];
  const missing = expected.filter((n) => !names.includes(n));
  const extra = names.filter((n) => !expected.includes(n));

  console.log("TOOLS", names.length, names.join(", "));
  console.log("MISSING", missing.length ? missing : "none");
  console.log("EXTRA", extra.length ? extra : "none");

  for (const d of ASSISTENTE_TOOL_DEFINITIONS) {
    if (d.type !== "function" || !d.function.name || !d.function.parameters) {
      console.error("BAD_DEF", d);
      process.exitCode = 1;
    }
  }

  // executeAssistenteTool must route writes to propose (never mutate here)
  const routed = await executeAssistenteTool("criar_prazo", {
    titulo: "Smoke",
    tipo: "outro",
    data_prazo: "2026-09-20",
  });
  console.log(
    routed.requiresConfirmation && routed.ok
      ? "OK execute→propose route"
      : "FAIL execute→propose route",
    routed.summary?.slice(0, 80)
  );

  const cases: Array<[string, Record<string, unknown>, boolean]> = [
    ["enviar_whatsapp", { texto: "Oi teste", telefone: "11999998888" }, true],
    ["enviar_whatsapp", { texto: "" }, false],
    [
      "criar_prazo",
      { titulo: "Recurso", tipo: "recurso", data_prazo: "2026-10-10" },
      true,
    ],
    [
      "criar_prazo",
      { titulo: "X", tipo: "invalido", data_prazo: "2026-10-10" },
      false,
    ],
    ["mover_kanban", { caso_id: 1, status: "aguardando_analise" }, true],
    ["mover_kanban", { caso_id: 1, status: "status_fake" }, false],
    [
      "anexar_documento_ficha",
      {
        pasta: "geral",
        contact_norm: "5511999998888",
        url_media: "https://example.com/a.jpg",
        mime_type: "image/jpeg",
        nome_documento: "RG",
      },
      true,
    ],
    [
      "anexar_documento_ficha",
      {
        pasta: "geral",
        contact_norm: "5511999998888",
        file_base64: "aaaa",
        file_name: "clip.mp4",
        mime_type: "video/mp4",
      },
      true,
    ],
    [
      "anexar_documento_ficha",
      {
        pasta: "geral",
        contact_norm: "5511999998888",
        file_base64: "aaaa",
        file_name: "x.bin",
        mime_type: "application/x-msdownload",
      },
      false,
    ],
    ["anexar_documento_ficha", { pasta: "geral" }, false],
    ["atualizar_caso", { caso_id: 42, nome: "Maria" }, true],
    ["atualizar_caso", { caso_id: 42 }, false],
    [
      "criar_cliente_caso",
      {
        nome: "Joao",
        telefone: "11988887777",
        status: "em_atendimento",
      },
      true,
    ],
    ["criar_cliente_caso", { nome: "Joao", telefone: "11988887777" }, false],
    ["criar_cliente_caso", { nome: "Joao" }, false],
    [
      "criar_cliente_caso",
      { nome: "Izadora teste", status: "aguardando_analise" },
      false,
    ],
    // Prompt edit: rejects invalid modo without needing DB (modo parse first...
    // actually propose loads config after modo — without session expect fail)
    [
      "propor_alteracao_prompt_agente",
      { modo: "modo_invalido", motivo: "teste" },
      false,
    ],
    // Revert: rejects missing versao_id without needing DB
    ["reverter_prompt_agente", {}, false],
  ];

  let failed = 0;
  if (!(routed.requiresConfirmation && routed.ok)) failed += 1;

  // Pending session media fills url_media when omitted
  {
    const withPending = await proposeAssistenteWriteTool(
      "anexar_documento_ficha",
      { pasta: "custom:teste", contact_norm: "5511999998888" },
      {
        pendingAnexo: {
          url_media: "https://example.com/pending.jpg",
          mime: "image/jpeg",
          nome_arquivo: "paciente.jpg",
          modo: "somente_salvar",
          kind: "image",
        },
      }
    );
    const pass =
      withPending.ok &&
      withPending.requiresConfirmation &&
      (withPending.data as { normalizedArgs?: { url_media?: string } })
        ?.normalizedArgs?.url_media === "https://example.com/pending.jpg";
    console.log(
      pass ? "OK" : "FAIL",
      "anexar+pending_anexo",
      withPending.summary?.slice(0, 60)
    );
    if (!pass) failed += 1;
  }

  // Link helpers
  {
    const {
      assistenteFichaHref,
      assistenteFichaArquivosHref,
      assistenteKanbanHref,
    } = await import("../lib/assistente/links");
    const ficha = assistenteFichaHref({ cpf: "529.982.247-25" });
    const pasta = assistenteFichaArquivosHref({
      cpf: "52998224725",
      pasta: "caso:12",
    });
    const kanban = assistenteKanbanHref(99);
    const linkPass =
      ficha === "/clientes/52998224725" &&
      pasta === "/clientes/52998224725?pasta=caso%3A12#arquivos" &&
      kanban === "/kanban/99";
    console.log(linkPass ? "OK" : "FAIL", "link helpers", ficha, pasta, kanban);
    if (!linkPass) failed += 1;
  }

  // Prompt edit helpers (pure, no DB)
  {
    const {
      applyPromptEdit,
      applyPromptEditsBatch,
      indexPromptSections,
      findExactOccurrences,
    } = await import("../lib/assistente/agente-prompt-edit");
    const sample = "# A\nhello\n<tag>\nx\n</tag>\n";
    const secs = indexPromptSections(sample);
    const sub = applyPromptEdit({
      modo: "substituir",
      personaAtual: sample,
      ancora: "hello",
      trecho_novo: "hi",
    });
    const dup = applyPromptEdit({
      modo: "substituir",
      personaAtual: "aa aa",
      ancora: "aa",
      trecho_novo: "b",
    });
    const batch = applyPromptEditsBatch({
      persona: "Sou a Ana.\nRegra: Ana responde.",
      mensagem_abertura: "Olá, sou Ana do escritório.",
      alteracoes: [
        {
          documento: "persona",
          modo: "substituir",
          ancora: "Sou a Ana.",
          trecho_novo: "Sou a Lia.",
          motivo: "nome persona 1",
        },
        {
          documento: "persona",
          modo: "substituir",
          ancora: "Regra: Ana responde.",
          trecho_novo: "Regra: Lia responde.",
          motivo: "nome persona 2",
        },
        {
          documento: "mensagem_abertura",
          modo: "substituir",
          ancora: "sou Ana do",
          trecho_novo: "sou Lia do",
          motivo: "nome abertura",
        },
      ],
    });
    const pass =
      secs.some((s) => s.name === "A") &&
      secs.some((s) => s.name === "tag") &&
      sub.ok &&
      sub.persona.includes("hi") &&
      !dup.ok &&
      findExactOccurrences("xx", "x").length === 2 &&
      batch.ok &&
      batch.previews.length === 3 &&
      batch.persona.includes("Lia") &&
      !batch.persona.includes("Ana") &&
      batch.mensagem_abertura.includes("Lia") &&
      !batch.mensagem_abertura.includes("Ana");
    console.log(pass ? "OK" : "FAIL", "prompt-edit helpers");
    if (!pass) failed += 1;
  }

  for (const [name, args, expectOk] of cases) {
    if (!isWriteTool(name)) throw new Error("not write " + name);
    const r = await proposeAssistenteWriteTool(name, args);
    const pass =
      r.ok === expectOk &&
      (expectOk
        ? r.requiresConfirmation === true && Boolean(r.confirmationId)
        : true);
    console.log(
      pass ? "OK" : "FAIL",
      name,
      expectOk ? "propose" : "reject",
      "|",
      r.summary?.slice(0, 90)
    );
    if (!pass) failed += 1;
  }

  // Read tools: validation / auth boundary (live RLS needs session cookies)
  for (const name of expectedRead) {
    const r = await executeAssistenteTool(name, {});
    console.log(
      "READ",
      name,
      r.ok ? "ok" : "err",
      "|",
      r.summary?.slice(0, 100)
    );
  }

  console.log("mime image", classifyAssistenteAnexo("image/png", "a.png"));
  console.log("mime video", classifyAssistenteAnexo("video/mp4", "a.mp4"));
  console.log("mime doc", classifyAssistenteAnexo("application/pdf", "a.pdf"));
  console.log("allowed video", isAllowedAssistenteMime("video/webm", "x.webm"));

  if (missing.length || failed) {
    console.error("SMOKE FAILED", { missing, failed });
    process.exit(1);
  }
  console.log("SMOKE OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
