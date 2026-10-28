/**
 * Helpers for reading / surgically editing the WhatsApp agent persona prompt.
 */

export type PromptSectionKind = "heading" | "tag";

export type PromptSectionIndex = {
  kind: PromptSectionKind;
  name: string;
  /** 1-indexed line number in the persona text. */
  line: number;
};

export type PromptEditModo =
  | "substituir"
  | "inserir_apos"
  | "inserir_antes"
  | "substituir_tudo";

/** Build an index of markdown headings and XML-like open tags. */
export function indexPromptSections(text: string): PromptSectionIndex[] {
  const lines = text.split("\n");
  const sections: PromptSectionIndex[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      sections.push({
        kind: "heading",
        name: heading[2]!.trim(),
        line: i + 1,
      });
      continue;
    }
    const tag = /^<([A-Za-z][\w.-]*)\s*>/.exec(line.trim());
    if (tag) {
      sections.push({ kind: "tag", name: tag[1]!, line: i + 1 });
    }
  }
  return sections;
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/^<|>$/g, "");
}

/**
 * Extract a named section (heading or tag). Returns null if not found.
 * For tags, includes content until matching `</name>` (or EOF).
 * For headings, includes until the next heading of same/higher level.
 */
export function extractPromptSection(
  text: string,
  secao: string
): { name: string; line: number; content: string } | null {
  const key = normalizeKey(secao);
  if (!key) return null;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading && normalizeKey(heading[2]!) === key) {
      const level = heading[1]!.length;
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        const h = /^(#{1,6})\s+/.exec(lines[j]!);
        if (h && h[1]!.length <= level) {
          end = j;
          break;
        }
      }
      return {
        name: heading[2]!.trim(),
        line: i + 1,
        content: lines.slice(i, end).join("\n"),
      };
    }

    const tag = /^<([A-Za-z][\w.-]*)\s*>/.exec(line.trim());
    if (tag && normalizeKey(tag[1]!) === key) {
      const close = `</${tag[1]}>`;
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]!.includes(close)) {
          end = j + 1;
          break;
        }
      }
      return {
        name: tag[1]!,
        line: i + 1,
        content: lines.slice(i, end).join("\n"),
      };
    }
  }
  return null;
}

/** Find occurrences of an exact substring; returns start indices. */
export function findExactOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const hits: number[] = [];
  let from = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    hits.push(idx);
    from = idx + Math.max(needle.length, 1);
  }
  return hits;
}

export function clipPreview(text: string, max = 280): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Clip while keeping newlines (for confirmation cards). */
export function clipPreviewBlock(text: string, max = 4000): string {
  const t = text.replace(/\r\n/g, "\n").trimEnd();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Nearest section (heading/tag) at or before a character offset,
 * plus 1-indexed line number.
 */
export function locatePromptOffset(
  text: string,
  offset: number
): { secao: string | null; linha: number; kind: PromptSectionKind | null } {
  const safe = Math.max(0, Math.min(offset, text.length));
  const linha = text.slice(0, safe).split("\n").length;
  const sections = indexPromptSections(text);
  let secao: string | null = null;
  let kind: PromptSectionKind | null = null;
  for (const s of sections) {
    if (s.line <= linha) {
      secao = s.name;
      kind = s.kind;
    } else {
      break;
    }
  }
  return { secao, linha, kind };
}

/** Context window around a match for zoom / preview. */
export function extractTrechoContext(
  text: string,
  trecho: string,
  radius = 220
): {
  matches: number;
  preview: string | null;
  start?: number;
} {
  const hits = findExactOccurrences(text, trecho);
  if (hits.length === 0) {
    // Soft fallback: case-insensitive first hit for read zoom only
    const lower = text.toLowerCase();
    const needle = trecho.toLowerCase();
    const soft = lower.indexOf(needle);
    if (soft < 0) return { matches: 0, preview: null };
    const start = Math.max(0, soft - radius);
    const end = Math.min(text.length, soft + trecho.length + radius);
    return {
      matches: 1,
      start: soft,
      preview: `${start > 0 ? "…" : ""}${text.slice(start, end)}${
        end < text.length ? "…" : ""
      }`,
    };
  }
  const startIdx = hits[0]!;
  const start = Math.max(0, startIdx - radius);
  const end = Math.min(text.length, startIdx + trecho.length + radius);
  return {
    matches: hits.length,
    start: startIdx,
    preview: `${start > 0 ? "…" : ""}${text.slice(start, end)}${
      end < text.length ? "…" : ""
    }`,
  };
}

export type PromptDocumento = "persona" | "mensagem_abertura";

export type ApplyPromptEditInput = {
  modo: PromptEditModo;
  /** Current document text (persona or mensagem_abertura). */
  personaAtual: string;
  /** Exact anchor text (required except substituir_tudo). */
  ancora?: string;
  trecho_novo?: string;
  texto_inserir?: string;
};

export type ApplyPromptEditResult =
  | {
      ok: true;
      persona: string;
      /** Matched / current snippet (for UI + chat). */
      antes: string;
      /** Proposed snippet after the edit. */
      depois: string;
      modo: PromptEditModo;
      /** Nearest heading/tag name, if any. */
      secao: string | null;
      /** 1-indexed line of the match (or 1 for substituir_tudo). */
      linha: number;
    }
  | { ok: false; summary: string };

export type PromptEditAlteracaoInput = {
  documento: PromptDocumento;
  modo: PromptEditModo;
  ancora?: string;
  trecho_novo?: string;
  texto_inserir?: string;
  motivo?: string;
};

export type PromptEditPreviewItem = {
  documento: PromptDocumento;
  before: string;
  after: string;
  modo: string;
  secao: string | null;
  linha: number | null;
  motivo?: string;
};

export type ApplyPromptEditsBatchResult =
  | {
      ok: true;
      persona: string;
      mensagem_abertura: string;
      previews: PromptEditPreviewItem[];
    }
  | { ok: false; summary: string };

export function parsePromptDocumento(raw: string): PromptDocumento | null {
  const d = raw.trim().toLowerCase();
  if (d === "persona" || d === "mensagem_abertura") return d;
  // Common aliases from the model
  if (d === "abertura" || d === "mensagem" || d === "msg_abertura") {
    return "mensagem_abertura";
  }
  if (d === "prompt" || d === "regras" || d === "system") return "persona";
  return null;
}

/**
 * Apply N surgical edits in order on persona and/or mensagem_abertura.
 * Each anchor must exist exactly once in the target document *as it stands*
 * after previous edits in the same batch.
 */
export function applyPromptEditsBatch(input: {
  persona: string;
  mensagem_abertura: string;
  alteracoes: PromptEditAlteracaoInput[];
}): ApplyPromptEditsBatchResult {
  if (!input.alteracoes.length) {
    return { ok: false, summary: "Informe ao menos uma alteração em alteracoes[]." };
  }

  let persona = input.persona;
  let mensagem_abertura = input.mensagem_abertura;
  const previews: PromptEditPreviewItem[] = [];

  for (let i = 0; i < input.alteracoes.length; i++) {
    const alt = input.alteracoes[i]!;
    const docLabel =
      alt.documento === "mensagem_abertura" ? "mensagem de abertura" : "persona";
    const current =
      alt.documento === "mensagem_abertura" ? mensagem_abertura : persona;

    const applied = applyPromptEdit({
      modo: alt.modo,
      personaAtual: current,
      ancora: alt.ancora,
      trecho_novo: alt.trecho_novo,
      texto_inserir: alt.texto_inserir,
    });
    if (!applied.ok) {
      return {
        ok: false,
        summary: `Alteração ${i + 1}/${input.alteracoes.length} (${docLabel}): ${applied.summary}`,
      };
    }

    if (alt.documento === "mensagem_abertura") {
      mensagem_abertura = applied.persona;
    } else {
      persona = applied.persona;
    }

    previews.push({
      documento: alt.documento,
      before: applied.antes,
      after: applied.depois,
      modo: applied.modo,
      secao: applied.secao,
      linha: applied.linha,
      ...(alt.motivo?.trim() ? { motivo: alt.motivo.trim() } : {}),
    });
  }

  return { ok: true, persona, mensagem_abertura, previews };
}

export function applyPromptEdit(
  input: ApplyPromptEditInput
): ApplyPromptEditResult {
  const modo = input.modo;
  const personaAtual = input.personaAtual;

  if (modo === "substituir_tudo") {
    const novo = (input.trecho_novo ?? "").trimEnd();
    if (!novo.trim()) {
      return {
        ok: false,
        summary: "substituir_tudo exige trecho_novo com o prompt completo.",
      };
    }
    return {
      ok: true,
      persona: novo,
      antes: clipPreviewBlock(personaAtual, 360),
      depois: clipPreviewBlock(novo, 360),
      modo,
      secao: null,
      linha: 1,
    };
  }

  const ancora = (input.ancora ?? "").trim() ? input.ancora! : "";
  if (!ancora) {
    return {
      ok: false,
      summary:
        "Informe ancora (ou trecho_atual) com o texto exato a localizar no rascunho.",
    };
  }

  const hits = findExactOccurrences(personaAtual, ancora);
  if (hits.length === 0) {
    return {
      ok: false,
      summary:
        "Âncora não encontrada no rascunho. Use ler_prompt_agente e copie o trecho exato (incluindo espaços/quebras).",
    };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      summary: `Âncora aparece ${hits.length} vezes. Amplie o trecho para ficar único e tente de novo.`,
    };
  }

  const idx = hits[0]!;
  const loc = locatePromptOffset(personaAtual, idx);
  let persona: string;
  let antes: string;
  let depois: string;

  if (modo === "substituir") {
    if (input.trecho_novo === undefined || input.trecho_novo === null) {
      return { ok: false, summary: "substituir exige trecho_novo." };
    }
    const trecho_novo = String(input.trecho_novo);
    persona =
      personaAtual.slice(0, idx) +
      trecho_novo +
      personaAtual.slice(idx + ancora.length);
    antes = clipPreviewBlock(ancora);
    depois = clipPreviewBlock(trecho_novo || "(removido)");
  } else if (modo === "inserir_apos") {
    const texto = input.texto_inserir ?? input.trecho_novo ?? "";
    if (!texto) {
      return { ok: false, summary: "inserir_apos exige texto_inserir (ou trecho_novo)." };
    }
    // Sem espaço entre a âncora e o texto novo, as frases grudavam ("mensagem.Se a…").
    const sep = /\s$/.test(ancora) || /^\s/.test(texto) ? "" : "\n";
    persona =
      personaAtual.slice(0, idx + ancora.length) +
      sep +
      texto +
      personaAtual.slice(idx + ancora.length);
    antes = clipPreviewBlock(ancora);
    depois = clipPreviewBlock(ancora + sep + texto);
  } else if (modo === "inserir_antes") {
    const texto = input.texto_inserir ?? input.trecho_novo ?? "";
    if (!texto) {
      return {
        ok: false,
        summary: "inserir_antes exige texto_inserir (ou trecho_novo).",
      };
    }
    const sep = /\s$/.test(texto) || /^\s/.test(ancora) ? "" : "\n";
    persona =
      personaAtual.slice(0, idx) + texto + sep + personaAtual.slice(idx);
    antes = clipPreviewBlock(ancora);
    depois = clipPreviewBlock(texto + sep + ancora);
  } else {
    return { ok: false, summary: `Modo inválido: ${modo}` };
  }

  return {
    ok: true,
    persona,
    antes,
    depois,
    modo,
    secao: loc.secao,
    linha: loc.linha,
  };
}

export function parsePromptEditModo(raw: string): PromptEditModo | null {
  const m = raw.trim() as PromptEditModo;
  if (
    m === "substituir" ||
    m === "inserir_apos" ||
    m === "inserir_antes" ||
    m === "substituir_tudo"
  ) {
    return m;
  }
  return null;
}
