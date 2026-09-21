"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  Bot,
  Check,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  abrirSessaoAssistente,
  cancelarAcaoAssistente,
  confirmarAcaoAssistente,
  enviarMensagemAssistente,
  iniciarSessaoAssistente,
  listarSessoesAssistente,
  novaSessaoAssistente,
  reiniciarSessaoAssistente,
} from "@/lib/actions/assistente";
import { dispatchAgenteConfigUpdated } from "@/lib/assistente/events";
import type {
  AssistenteAnexoInput,
  AssistenteAnexoKind,
  AssistenteAnexoModo,
  AssistenteMessage,
  AssistentePromptEditPreviewItem,
  AssistenteSessaoListItem,
  AssistenteToolTraceItem,
} from "@/lib/assistente/types";
import { labelForOffset } from "@/lib/prazos/lembretes";
import { cn } from "@/lib/utils";

const inputShell =
  "border-[#e2e8f0] bg-white text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12";

const ACCEPT_FILES =
  "image/*,video/*,.pdf,.txt,.md,.doc,.docx,.csv,application/pdf,text/plain";

type PendingAnexo = {
  kind: AssistenteAnexoKind;
  base64: string;
  mimeType: string;
  fileName: string;
  previewUrl: string | null;
  /** null until user picks Interpretar | Só salvar */
  modo: AssistenteAnexoModo | null;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const b64 = result.includes(",") ? result.split(",", 2)[1]! : result;
      resolve(b64);
    };
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

function classifyFile(file: File): AssistenteAnexoKind {
  const mime = (file.type || "").toLowerCase();
  const name = file.name || "";
  if (mime.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp)$/i.test(name)) {
    return "image";
  }
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|mkv|m4v)$/i.test(name)) {
    return "video";
  }
  if (mime.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|webm)$/i.test(name)) {
    return "audio";
  }
  return "documento";
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/** Lightweight safe markdown: **bold**, newlines, simple - / * / 1. lists. No HTML. */
function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    nodes.push(
      <strong key={`${keyPrefix}-b-${i++}`} className="font-semibold">
        {match[1]}
      </strong>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function ChatMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let listBuf: { ordered: boolean; items: string[] } | null = null;
  let blockKey = 0;

  const flushList = () => {
    if (!listBuf) return;
    const Tag = listBuf.ordered ? "ol" : "ul";
    const listClass = listBuf.ordered
      ? "my-1 list-decimal space-y-0.5 pl-4"
      : "my-1 list-disc space-y-0.5 pl-4";
    blocks.push(
      <Tag key={`list-${blockKey++}`} className={listClass}>
        {listBuf.items.map((item, idx) => (
          <li key={idx}>{renderInlineMarkdown(item, `li-${blockKey}-${idx}`)}</li>
        ))}
      </Tag>
    );
    listBuf = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);

    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const item = (unordered?.[1] ?? ordered?.[1] ?? "").trim();
      if (!listBuf || listBuf.ordered !== orderedList) {
        flushList();
        listBuf = { ordered: orderedList, items: [item] };
      } else {
        listBuf.items.push(item);
      }
      continue;
    }

    flushList();

    if (line.trim() === "") {
      blocks.push(<div key={`br-${blockKey++}`} className="h-2" />);
      continue;
    }

    blocks.push(
      <p key={`p-${blockKey++}`} className="whitespace-pre-wrap">
        {renderInlineMarkdown(line, `p-${blockKey}`)}
      </p>
    );
  }
  flushList();

  return <div className={cn("space-y-0.5 [&_p]:m-0", className)}>{blocks}</div>;
}

function WaitingDots() {
  return (
    <div
      className="flex max-w-[4.5rem] items-center justify-center gap-1 rounded-2xl border border-[#e2e8f0] bg-white px-3.5 py-3"
      role="status"
      aria-label="Assistente respondendo"
    >
      <span className="size-1.5 animate-bounce rounded-full bg-[#0b2148]/35 [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-[#0b2148]/45 [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-[#0b2148]/55" />
    </div>
  );
}

function toolLabel(name: string): string {
  switch (name) {
    case "enviar_whatsapp":
      return "Enviar WhatsApp";
    case "criar_prazo":
      return "Criar prazo";
    case "mover_kanban":
      return "Mover no kanban";
    case "anexar_documento_ficha":
      return "Anexar documento";
    case "atualizar_caso":
      return "Atualizar caso";
    case "criar_cliente_caso":
      return "Criar cliente/caso";
    case "propor_alteracao_prompt_agente":
      return "Alterar prompt do agente";
    case "reverter_prompt_agente":
      return "Reverter prompt do agente";
    default:
      return name;
  }
}

type PromptEditPreviewUi = {
  before: string;
  after: string;
  modo: string | null;
  secao: string | null;
  linha: number | null;
  alteracoes: AssistentePromptEditPreviewItem[];
};

function readNormalizedArgs(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const norm = (data as Record<string, unknown>).normalizedArgs;
  if (!norm || typeof norm !== "object" || Array.isArray(norm)) return null;
  return norm as Record<string, unknown>;
}

function criarPrazoConfirmExtras(
  args: Record<string, unknown>
): { hora: string; lembretes: string } {
  const horaRaw =
    typeof args.hora_prazo === "string" ? args.hora_prazo.trim() : "";
  const hora = horaRaw ? horaRaw.slice(0, 5) : "08:00";
  const raw = args.lembretes;
  if (Array.isArray(raw) && raw.length) {
    const lines: { offset: number; label: string }[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const offset = Math.max(0, Math.floor(Number(rec.offset_minutes)));
      if (!Number.isFinite(offset)) continue;
      const label =
        typeof rec.label === "string" && rec.label.trim()
          ? rec.label.trim()
          : labelForOffset(offset);
      lines.push({ offset, label });
    }
    const sorted = lines.sort((a, b) => b.offset - a.offset);
    if (sorted.length) {
      return { hora, lembretes: sorted.map((l) => l.label).join(", ") };
    }
  }
  return { hora, lembretes: "1 hora antes, na hora" };
}

function readPromptEditPreview(data: unknown): PromptEditPreviewUi | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const nested =
    d.preview && typeof d.preview === "object" && !Array.isArray(d.preview)
      ? (d.preview as Record<string, unknown>)
      : null;

  const alteracoesRaw = Array.isArray(d.alteracoes)
    ? d.alteracoes
    : Array.isArray(nested?.alteracoes)
      ? nested.alteracoes
      : [];

  const alteracoes: AssistentePromptEditPreviewItem[] = [];
  for (const raw of alteracoesRaw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const a = raw as Record<string, unknown>;
    const documento =
      a.documento === "mensagem_abertura" ? "mensagem_abertura" : "persona";
    const before =
      (typeof a.before === "string" && a.before) ||
      (typeof a.antes === "string" && a.antes) ||
      "";
    const after =
      (typeof a.after === "string" && a.after) ||
      (typeof a.depois === "string" && a.depois) ||
      "";
    if (!before && !after) continue;
    alteracoes.push({
      documento,
      before,
      after,
      modo: typeof a.modo === "string" ? a.modo : "",
      secao: typeof a.secao === "string" && a.secao.trim() ? a.secao.trim() : null,
      linha:
        typeof a.linha === "number" && Number.isFinite(a.linha)
          ? Math.trunc(a.linha)
          : null,
      ...(typeof a.motivo === "string" && a.motivo.trim()
        ? { motivo: a.motivo.trim() }
        : {}),
    });
  }

  const before =
    (typeof d.before === "string" && d.before) ||
    (typeof nested?.before === "string" && nested.before) ||
    (typeof nested?.antes === "string" && nested.antes) ||
    "";
  const after =
    (typeof d.after === "string" && d.after) ||
    (typeof nested?.after === "string" && nested.after) ||
    (typeof nested?.depois === "string" && nested.depois) ||
    "";
  if (!before && !after && alteracoes.length === 0) return null;

  const modoRaw = d.modo ?? nested?.modo;
  const secaoRaw = d.secao ?? nested?.secao;
  const linhaRaw = d.linha ?? nested?.linha;

  return {
    before,
    after,
    modo: typeof modoRaw === "string" && modoRaw.trim() ? modoRaw.trim() : null,
    secao:
      typeof secaoRaw === "string" && secaoRaw.trim() ? secaoRaw.trim() : null,
    linha:
      typeof linhaRaw === "number" && Number.isFinite(linhaRaw)
        ? Math.trunc(linhaRaw)
        : null,
    alteracoes,
  };
}

function PromptDiffBlock({
  item,
  index,
  total,
}: {
  item: {
    documento?: string;
    before: string;
    after: string;
    modo: string | null;
    secao: string | null;
    linha: number | null;
    motivo?: string;
  };
  index?: number;
  total?: number;
}) {
  const doc =
    item.documento === "mensagem_abertura"
      ? "Mensagem de abertura"
      : item.documento === "persona"
        ? "Persona"
        : null;
  const titleParts = [
    total != null && total > 1 && index != null
      ? `${index + 1}/${total}`
      : null,
    doc,
    item.motivo,
  ].filter(Boolean);

  return (
    <div className="space-y-2 rounded-lg border border-amber-200/80 bg-white/70 px-2.5 py-2">
      {titleParts.length ? (
        <p className="text-[11px] font-semibold text-[#0b2148]">
          {titleParts.join(" · ")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#475569]">
        {item.modo ? (
          <span>
            Modo:{" "}
            <span className="font-medium text-[#0b2148]">{item.modo}</span>
          </span>
        ) : null}
        {item.secao || item.linha != null ? (
          <span>
            Local:{" "}
            <span className="font-medium text-[#0b2148]">
              {[
                item.secao ? `seção ${item.secao}` : null,
                item.linha != null ? `~linha ${item.linha}` : null,
              ]
                .filter(Boolean)
                .join(", ") || "—"}
            </span>
          </span>
        ) : null}
      </div>
      {item.before ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
            Antes
          </p>
          <pre className="mt-0.5 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-[#64748B]">
            {item.before}
          </pre>
        </div>
      ) : null}
      {item.after ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700/80">
            Depois
          </p>
          <pre className="mt-0.5 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-[#0b2148]">
            {item.after}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function ConfirmCard({
  messageId,
  item,
  disabled,
  onConfirm,
  onCancel,
}: {
  messageId: string;
  item: AssistenteToolTraceItem;
  disabled: boolean;
  onConfirm: (messageId: string, confirmationId: string) => void;
  onCancel: (messageId: string, confirmationId: string) => void;
}) {
  const status = item.confirmationStatus;
  const id = item.confirmationId;
  if (!id) return null;

  const label =
    item.result.confirmationLabel ||
    item.result.summary ||
    toolLabel(item.name);

  const promptPreview = readPromptEditPreview(item.result.data);
  const prazoExtras =
    item.name === "criar_prazo"
      ? (() => {
          const args = readNormalizedArgs(item.result.data);
          return args ? criarPrazoConfirmExtras(args) : null;
        })()
      : null;

  if (status === "confirmed") {
    return (
      <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        Confirmado: {label}
      </div>
    );
  }
  if (status === "cancelled") {
    return (
      <div className="mt-2 rounded-xl border border-[#e2e8f0] bg-[#F8FAFC] px-3 py-2 text-xs text-[#64748B]">
        Cancelado: {label}
      </div>
    );
  }
  if (status !== "pending" && !item.result.requiresConfirmation) {
    return null;
  }

  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
        Confirmação necessária
      </p>
      <p className="mt-1 text-xs font-medium text-[#0b2148]">{label}</p>
      <p className="mt-0.5 text-[11px] text-[#64748B]">
        {toolLabel(item.name)}
      </p>
      {prazoExtras ? (
        <p className="mt-1 text-[11px] text-[#475569]">
          Horário:{" "}
          <span className="font-medium text-[#0b2148]">{prazoExtras.hora}</span>
          {" · "}
          Lembretes:{" "}
          <span className="font-medium text-[#0b2148]">
            {prazoExtras.lembretes}
          </span>
        </p>
      ) : null}
      {promptPreview ? (
        <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-0.5">
          {promptPreview.alteracoes.length > 0
            ? promptPreview.alteracoes.map((alt, i) => (
                <PromptDiffBlock
                  key={`${alt.documento}-${i}`}
                  item={alt}
                  index={i}
                  total={promptPreview.alteracoes.length}
                />
              ))
            : (
                <PromptDiffBlock
                  item={{
                    before: promptPreview.before,
                    after: promptPreview.after,
                    modo: promptPreview.modo,
                    secao: promptPreview.secao,
                    linha: promptPreview.linha,
                  }}
                />
              )}
        </div>
      ) : null}
      <div className="mt-2.5 flex gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 bg-[#0b2148] text-white hover:bg-[#0b2148]/90"
          disabled={disabled}
          onClick={() => onConfirm(messageId, id)}
        >
          <Check className="size-3.5" />
          Confirmar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 border-[#e2e8f0] text-[#0b2148]"
          disabled={disabled}
          onClick={() => onCancel(messageId, id)}
        >
          <X className="size-3.5" />
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function AssistenteDrawer() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sessaoId, setSessaoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistenteMessage[]>([]);
  const [booting, setBooting] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pendingAnexo, setPendingAnexo] = useState<PendingAnexo | null>(null);
  const [pending, startTransition] = useTransition();
  const [modelLabel, setModelLabel] = useState<string | null>(null);
  const [sessoes, setSessoes] = useState<AssistenteSessaoListItem[]>([]);
  const [showSessoes, setShowSessoes] = useState(false);
  const [loadingSessoes, setLoadingSessoes] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessaoRef = useRef<string | null>(null);
  const bootedRef = useRef(false);

  function applySession(res: {
    sessaoId: string;
    messages: AssistenteMessage[];
    model?: string;
  }) {
    sessaoRef.current = res.sessaoId;
    setSessaoId(res.sessaoId);
    setMessages(res.messages);
    if (res.model) setModelLabel(res.model);
  }

  async function refreshSessoes() {
    try {
      setLoadingSessoes(true);
      const list = await listarSessoesAssistente();
      setSessoes(list);
    } catch {
      // Non-fatal — list is optional chrome
    } finally {
      setLoadingSessoes(false);
    }
  }

  useEffect(() => {
    if (!open || bootedRef.current) return;
    let cancelled = false;
    setBooting(true);

    iniciarSessaoAssistente()
      .then((res) => {
        if (cancelled) return;
        applySession(res);
        bootedRef.current = true;
        void refreshSessoes();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg =
          e instanceof Error ? e.message : "Falha ao iniciar assistente";
        toast.error(msg);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, awaitingReply, open]);

  function clearPendingAnexo(opts?: { revoke?: boolean }) {
    if (opts?.revoke !== false && pendingAnexo?.previewUrl) {
      URL.revokeObjectURL(pendingAnexo.previewUrl);
    }
    setPendingAnexo(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onPickFile(file: File | null | undefined) {
    if (!file) return;
    const kind = classifyFile(file);
    try {
      const base64 = await fileToBase64(file);
      clearPendingAnexo();
      setPendingAnexo({
        kind,
        base64,
        mimeType: file.type || "application/octet-stream",
        fileName: file.name || "arquivo",
        previewUrl:
          kind === "image" || kind === "video"
            ? URL.createObjectURL(file)
            : null,
        modo: null,
      });
    } catch {
      toast.error("Não foi possível anexar o arquivo");
    }
  }

  function restart() {
    startTransition(async () => {
      try {
        setAwaitingReply(false);
        setConfirmingId(null);
        clearPendingAnexo();
        const res = await reiniciarSessaoAssistente({
          sessaoId: sessaoRef.current,
        });
        applySession(res);
        setDraft("");
        setShowSessoes(false);
        void refreshSessoes();
        toast.success("Conversa reiniciada");
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Falha ao reiniciar");
      }
    });
  }

  function novaConversa() {
    startTransition(async () => {
      try {
        setAwaitingReply(false);
        setConfirmingId(null);
        clearPendingAnexo();
        const res = await novaSessaoAssistente();
        applySession(res);
        setDraft("");
        setShowSessoes(false);
        void refreshSessoes();
        toast.success("Nova conversa");
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Falha ao criar conversa");
      }
    });
  }

  function abrirConversa(id: string) {
    if (id === sessaoRef.current) {
      setShowSessoes(false);
      return;
    }
    startTransition(async () => {
      try {
        setAwaitingReply(false);
        setConfirmingId(null);
        clearPendingAnexo();
        const res = await abrirSessaoAssistente(id);
        applySession(res);
        setDraft("");
        setShowSessoes(false);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Falha ao abrir conversa");
      }
    });
  }

  function toggleSessoes() {
    const next = !showSessoes;
    setShowSessoes(next);
    if (next) void refreshSessoes();
  }

  function applyConfirmResult(
    messageId: string,
    updated: AssistenteMessage,
    followUp: AssistenteMessage
  ) {
    setMessages((prev) => {
      const next = prev.map((m) => (m.id === messageId ? updated : m));
      return [...next, followUp];
    });
  }

  function isPromptWriteTool(name: string) {
    return (
      name === "propor_alteracao_prompt_agente" ||
      name === "reverter_prompt_agente"
    );
  }

  function confirmAction(messageId: string, confirmationId: string) {
    if (!sessaoId || confirmingId) return;
    const pendingItem = messages
      .find((m) => m.id === messageId)
      ?.tool_trace.find((t) => t.confirmationId === confirmationId);
    setConfirmingId(confirmationId);
    startTransition(async () => {
      try {
        const res = await confirmarAcaoAssistente({
          sessaoId,
          messageId,
          confirmationId,
        });
        applyConfirmResult(
          messageId,
          res.updatedMessage,
          res.followUpMessage
        );
        toast.success("Ação confirmada");
        if (pendingItem && isPromptWriteTool(pendingItem.name)) {
          dispatchAgenteConfigUpdated();
        }
        void refreshSessoes();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Falha ao confirmar");
      } finally {
        setConfirmingId(null);
      }
    });
  }

  function cancelAction(messageId: string, confirmationId: string) {
    if (!sessaoId || confirmingId) return;
    setConfirmingId(confirmationId);
    startTransition(async () => {
      try {
        const res = await cancelarAcaoAssistente({
          sessaoId,
          messageId,
          confirmationId,
        });
        applyConfirmResult(
          messageId,
          res.updatedMessage,
          res.followUpMessage
        );
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Falha ao cancelar");
      } finally {
        setConfirmingId(null);
      }
    });
  }

  function send(text?: string) {
    const content = (text ?? draft).trim();
    const anexo = pendingAnexo;
    if (
      (!content && !anexo) ||
      !sessaoId ||
      awaitingReply ||
      pending ||
      booting
    ) {
      return;
    }
    if (anexo && !anexo.modo) {
      toast.error("Escolha Interpretar ou Só salvar para o anexo");
      return;
    }

    const optimisticId = `opt-${Date.now()}`;
    const optimistic: AssistenteMessage = {
      id: optimisticId,
      role: "user",
      content: content || (anexo ? `[Anexo] ${anexo.fileName}` : ""),
      tool_trace: [],
      anexos: anexo
        ? [
            {
              kind: anexo.kind,
              modo: anexo.modo!,
              fileName: anexo.fileName,
              mimeType: anexo.mimeType,
              url: anexo.previewUrl,
            },
          ]
        : [],
      created_at: new Date().toISOString(),
    };

    const anexoPayload: AssistenteAnexoInput | null = anexo
      ? {
          kind: anexo.kind,
          modo: anexo.modo!,
          base64: anexo.base64,
          mimeType: anexo.mimeType,
          fileName: anexo.fileName,
        }
      : null;
    const draftSnapshot = content;
    const blobToRevoke = anexo?.previewUrl ?? null;

    setDraft("");
    clearPendingAnexo({ revoke: false });
    setMessages((prev) => [...prev, optimistic]);
    setAwaitingReply(true);

    startTransition(async () => {
      try {
        const res = await enviarMensagemAssistente({
          sessaoId,
          content: draftSnapshot,
          anexo: anexoPayload,
        });
        if (res.model) setModelLabel(res.model);
        setMessages((prev) => {
          const withoutOpt = prev.filter((m) => m.id !== optimisticId);
          return [...withoutOpt, res.userMessage, res.assistantMessage];
        });
        void refreshSessoes();
      } catch (e: unknown) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setDraft(draftSnapshot);
        toast.error(e instanceof Error ? e.message : "Falha ao enviar");
      } finally {
        if (blobToRevoke) URL.revokeObjectURL(blobToRevoke);
        setAwaitingReply(false);
      }
    });
  }

  const busy = pending || booting || awaitingReply || Boolean(confirmingId);
  const anexoReady = !pendingAnexo || pendingAnexo.modo != null;
  const canSend =
    Boolean(sessaoId) &&
    (draft.trim().length > 0 || Boolean(pendingAnexo)) &&
    anexoReady &&
    !awaitingReply &&
    !booting &&
    !confirmingId;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!open ? (
        <SheetTrigger
          render={
            <button
              type="button"
              className="fixed bottom-20 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-[#0b2148] text-white shadow-lg transition-colors hover:bg-[#0b2148]/90 lg:bottom-6 lg:right-6"
              aria-label="Abrir assistente"
              title="Assistente"
            />
          }
        >
          <Sparkles className="size-6" />
        </SheetTrigger>
      ) : null}
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-[#e2e8f0] bg-[#F8FAFC] p-0 sm:max-w-md"
        showCloseButton
      >
        <SheetHeader className="shrink-0 border-b border-[#e2e8f0] bg-white px-4 py-3 pr-12">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <SheetTitle className="flex items-center gap-2 text-[#0b2148]">
                <Bot className="size-4 shrink-0" />
                Assistente interno
              </SheetTitle>
              <SheetDescription className="text-[#64748B]">
                Consulte e execute ações do escritório — escritas pedem
                confirmação.
              </SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="border-[#e2e8f0] text-[#0b2148]"
                disabled={busy || !sessaoId}
                onClick={toggleSessoes}
                aria-label="Conversas"
                title="Conversas"
              >
                <MessageSquare className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="border-[#e2e8f0] text-[#0b2148]"
                disabled={busy}
                onClick={novaConversa}
                aria-label="Nova conversa"
                title="Nova conversa"
              >
                <Plus className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="border-[#e2e8f0] text-[#0b2148]"
                disabled={busy || !sessaoId}
                onClick={restart}
                aria-label="Reiniciar conversa"
                title="Reiniciar"
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </div>
          </div>
        </SheetHeader>

        {showSessoes ? (
          <div className="shrink-0 border-b border-[#e2e8f0] bg-white px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                Conversas
              </p>
              <button
                type="button"
                className="text-[11px] font-medium text-[#0b2148] underline-offset-2 hover:underline"
                disabled={busy}
                onClick={novaConversa}
              >
                Nova conversa
              </button>
            </div>
            {loadingSessoes ? (
              <div className="flex items-center gap-2 py-3 text-xs text-[#64748B]">
                <Loader2 className="size-3.5 animate-spin" />
                Carregando…
              </div>
            ) : sessoes.length === 0 ? (
              <p className="py-2 text-xs text-[#64748B]">Nenhuma conversa ainda.</p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {sessoes.map((s) => {
                  const active = s.id === sessaoId;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => abrirConversa(s.id)}
                        className={cn(
                          "flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                          active
                            ? "bg-[#0b2148]/8 text-[#0b2148]"
                            : "text-[#475569] hover:bg-[#F8FAFC]"
                        )}
                      >
                        <span className="line-clamp-2 font-medium text-[#0b2148]">
                          {s.preview}
                        </span>
                        <span className="mt-0.5 text-[10px] text-[#94a3b8]">
                          {formatTime(s.updated_at)}
                          {s.message_count
                            ? ` · ${s.message_count} msg`
                            : " · vazia"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        <div
          ref={listRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
        >
          {booting ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#64748B]">
              <Loader2 className="size-4 animate-spin" />
              Preparando sessão…
            </div>
          ) : null}

          {!booting && messages.length === 0 && !awaitingReply ? (
            <div className="rounded-2xl border border-dashed border-[#e2e8f0] bg-white px-4 py-6 text-center">
              <p className="text-sm font-medium text-[#0b2148]">
                Como posso ajudar?
              </p>
              <p className="mt-1 text-xs text-[#64748B]">
                Ex.: “Buscar Maria Silva”, “Criar prazo de recurso…”, “Mover
                caso para aguardando análise”
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {[
                  "Prazos dos próximos 7 dias",
                  "Listar casos em aguardando_analise",
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    disabled={!sessaoId || busy}
                    onClick={() => send(chip)}
                    className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs font-medium text-[#0b2148] hover:border-[#0b2148]/30 hover:bg-[#F8FAFC] disabled:opacity-50"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm",
                m.role === "assistant"
                  ? "border border-[#e2e8f0] bg-white text-[#0b2148]"
                  : "ml-auto bg-[#0b2148] text-white"
              )}
            >
              {m.anexos?.length ? (
                <div className="mb-1.5 space-y-1">
                  {m.anexos.map((a, i) => (
                    <div
                      key={`${a.fileName}-${i}`}
                      className={cn(
                        "flex items-center gap-1.5 text-[11px]",
                        m.role === "user" ? "text-white/80" : "text-[#64748B]"
                      )}
                    >
                      <FileText className="size-3 shrink-0" />
                      <span className="truncate">{a.fileName}</span>
                      <span className="shrink-0 opacity-70">
                        ·{" "}
                        {a.modo === "somente_salvar"
                          ? "só salvar"
                          : "interpretar"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <ChatMarkdown
                text={m.content}
                className={
                  m.role === "user" ? "[&_strong]:text-white" : undefined
                }
              />
              {m.role === "assistant" && m.tool_trace?.length ? (
                <div className="mt-2 space-y-1 border-t border-[#e2e8f0] pt-2">
                  {m.tool_trace.map((t) =>
                    t.confirmationId ? (
                      <ConfirmCard
                        key={t.confirmationId}
                        messageId={m.id}
                        item={t}
                        disabled={busy}
                        onConfirm={confirmAction}
                        onCancel={cancelAction}
                      />
                    ) : null
                  )}
                  {(() => {
                    const seen = new Set<string>();
                    return m.tool_trace.flatMap((t, ti) =>
                      (t.result.links ?? []).slice(0, 3).flatMap((link, li) => {
                        if (seen.has(link.href)) return [];
                        seen.add(link.href);
                        return [
                          <Link
                            key={`${t.name}-${link.href}-${ti}-${li}`}
                            href={link.href}
                            className="block truncate text-xs font-medium text-[#0b2148] underline-offset-2 hover:underline"
                            onClick={() => setOpen(false)}
                          >
                            {link.label}
                          </Link>,
                        ];
                      })
                    );
                  })()}
                </div>
              ) : null}
              <p
                className={cn(
                  "mt-1 text-right text-[10px]",
                  m.role === "assistant" ? "text-[#94a3b8]" : "text-white/70"
                )}
              >
                {formatTime(m.created_at)}
              </p>
            </div>
          ))}

          {awaitingReply ? <WaitingDots /> : null}
        </div>

        <div className="shrink-0 border-t border-[#e2e8f0] bg-white p-3">
          {pendingAnexo ? (
            <div className="mb-2 rounded-xl border border-[#e2e8f0] bg-[#F8FAFC] px-3 py-2.5">
              <div className="flex items-start gap-2">
                {pendingAnexo.kind === "image" && pendingAnexo.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pendingAnexo.previewUrl}
                    alt=""
                    className="size-10 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-[#e2e8f0] bg-white">
                    <FileText className="size-4 text-[#0b2148]" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[#0b2148]">
                    {pendingAnexo.fileName}
                  </p>
                  {!pendingAnexo.modo ? (
                    <div className="mt-1.5">
                      <p className="text-[11px] text-[#64748B]">
                        O que fazer com o anexo?
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 bg-[#0b2148] text-white hover:bg-[#0b2148]/90"
                          onClick={() =>
                            setPendingAnexo((p) =>
                              p ? { ...p, modo: "interpretar" } : p
                            )
                          }
                        >
                          Interpretar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 border-[#e2e8f0] text-[#0b2148]"
                          onClick={() =>
                            setPendingAnexo((p) =>
                              p ? { ...p, modo: "somente_salvar" } : p
                            )
                          }
                        >
                          Só salvar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-[#64748B]">
                      {pendingAnexo.modo === "interpretar"
                        ? "Interpretar — descrever/transcrever e usar na conversa"
                        : "Só salvar — sem analisar; destino na ficha via confirmação"}
                      {" · "}
                      <button
                        type="button"
                        className="underline underline-offset-2"
                        onClick={() =>
                          setPendingAnexo((p) =>
                            p ? { ...p, modo: null } : p
                          )
                        }
                      >
                        alterar
                      </button>
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-md p-1 text-[#64748B] hover:bg-white hover:text-[#0b2148]"
                  aria-label="Remover anexo"
                  onClick={() => clearPendingAnexo()}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_FILES}
              className="hidden"
              onChange={(e) => {
                void onPickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0 border-[#e2e8f0] text-[#0b2148]"
              disabled={
                booting || !sessaoId || Boolean(confirmingId) || awaitingReply
              }
              onClick={() => fileInputRef.current?.click()}
              aria-label="Anexar arquivo"
              title="Anexar imagem, vídeo ou documento"
            >
              <Paperclip className="size-4" />
            </Button>
            <Textarea
              className={cn(
                inputShell,
                "min-h-[44px] max-h-32 flex-1 resize-none"
              )}
              placeholder="Pergunte, anexe arquivo ou peça uma ação…"
              value={draft}
              disabled={booting || !sessaoId || Boolean(confirmingId)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Button
              type="button"
              className="rounded-full bg-[#0b2148] text-white hover:bg-[#0b2148]/90"
              disabled={!canSend}
              onClick={() => send()}
            >
              {awaitingReply ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              <span className="sr-only">Enviar</span>
            </Button>
          </div>
          {modelLabel ? (
            <p className="mt-2 text-center text-[10px] text-[#94a3b8]">
              Modelo: {modelLabel}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
