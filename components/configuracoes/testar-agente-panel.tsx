"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { FileText, ImagePlus, Loader2, Mic, RotateCcw, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { TipoCasoMatch } from "@/lib/actions/tipos-caso";
import {
  enviarMensagemSandbox,
  iniciarSessaoSandbox,
  reiniciarSessaoSandbox,
  type SandboxMediaKind,
  type SandboxMessage,
  type SandboxVersao,
} from "@/lib/actions/agente-sandbox";
import { cn } from "@/lib/utils";

const cardShell =
  "rounded-2xl border border-[#e2e8f0] bg-white shadow-none";
const inputShell =
  "border-[#e2e8f0] bg-white text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12";
const btnPrimary =
  "rounded-full bg-[#0b2148] text-white hover:bg-[#0b2148]/90";
const btnOutline =
  "rounded-full border-[#e2e8f0] bg-white text-[#0b2148] hover:bg-[#F8FAFC]";
const iconBtn =
  "size-9 shrink-0 rounded-full border border-[#e2e8f0] bg-white text-[#0b2148] hover:bg-[#F8FAFC]";

const QUICK_CHIPS = [
  "Quero dar entrada",
  "Quais documentos?",
  "Falar com advogado",
  "Quanto vou receber?",
] as const;

type PendingMedia = {
  kind: SandboxMediaKind;
  base64: string;
  mimeType: string;
  fileName: string;
  previewUrl: string | null;
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

export function TestarAgentePanel({
  tipos,
  escritorioNome,
}: {
  tipos: TipoCasoMatch[];
  escritorioNome: string;
}) {
  const ativos = useMemo(
    () => tipos.filter((t) => t.ativo),
    [tipos]
  );
  const [tipoId, setTipoId] = useState(
    () => ativos[0]?.id ?? tipos[0]?.id ?? ativos[0]?.chave ?? tipos[0]?.chave ?? ""
  );
  const [versao, setVersao] = useState<SandboxVersao>("rascunho");
  const [draft, setDraft] = useState("");
  const [sessaoId, setSessaoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SandboxMessage[]>([]);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia | null>(null);
  const [encaminhar, setEncaminhar] = useState(false);
  const [proximoDoc, setProximoDoc] = useState<string | null>(
    () => ativos[0]?.documentos[0] ?? null
  );
  const [modelLabel, setModelLabel] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [booting, setBooting] = useState(true);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sessaoRef = useRef<string | null>(null);

  const tipoSelecionado =
    ativos.find((t) => t.id === tipoId || t.chave === tipoId) ??
    tipos.find((t) => t.id === tipoId || t.chave === tipoId) ??
    null;

  const scenarioKey = `${versao}|${tipoId}`;

  useEffect(() => {
    let cancelled = false;
    setBooting(true);
    setBootError(null);

    const prevId = sessaoRef.current;
    const boot = prevId
      ? reiniciarSessaoSandbox({
          sessaoId: prevId,
          versao,
          tipoCasoId: tipoSelecionado?.id ?? null,
          tipoCasoLabel: tipoSelecionado?.label ?? null,
          documentos: tipoSelecionado?.documentos ?? [],
          escritorioNome,
        })
      : iniciarSessaoSandbox({
          versao,
          tipoCasoId: tipoSelecionado?.id ?? null,
          tipoCasoLabel: tipoSelecionado?.label ?? null,
          documentos: tipoSelecionado?.documentos ?? [],
          escritorioNome,
        });

    boot
      .then((res) => {
        if (cancelled) return;
        sessaoRef.current = res.sessaoId;
        setSessaoId(res.sessaoId);
        setMessages(res.messages);
        setEncaminhar(false);
        setProximoDoc(tipoSelecionado?.documentos[0] ?? null);
        setModelLabel(null);
        setDraft("");
        setAwaitingReply(false);
        clearPendingMedia();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Falha ao iniciar sandbox";
        setBootError(msg);
        toast.error(msg);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });

    return () => {
      cancelled = true;
    };
    // Restart when versao/tipo changes (new scenario)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scenarioKey encodes versao+tipo
  }, [scenarioKey]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, awaitingReply]);

  function clearPendingMedia(opts?: { revoke?: boolean }) {
    if (opts?.revoke !== false && pendingMedia?.previewUrl) {
      URL.revokeObjectURL(pendingMedia.previewUrl);
    }
    setPendingMedia(null);
  }

  async function onPickFile(
    file: File | null | undefined,
    kind: SandboxMediaKind
  ) {
    if (!file) return;
    if (kind === "image" && !file.type.startsWith("image/")) {
      toast.error("Selecione uma imagem");
      return;
    }
    if (kind === "audio" && !file.type.startsWith("audio/")) {
      toast.error("Selecione um áudio");
      return;
    }
    if (
      kind === "documento" &&
      (file.type.startsWith("image/") || file.type.startsWith("audio/"))
    ) {
      toast.error("Use os botões de imagem ou áudio para esses tipos");
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      clearPendingMedia();
      const defaultName =
        kind === "image"
          ? "imagem.jpg"
          : kind === "audio"
            ? "audio.webm"
            : "documento.pdf";
      setPendingMedia({
        kind,
        base64,
        mimeType: file.type || "application/octet-stream",
        fileName: file.name || defaultName,
        previewUrl:
          kind === "documento" ? null : URL.createObjectURL(file),
      });
    } catch {
      toast.error("Não foi possível anexar o arquivo");
    }
  }

  function reiniciar() {
    startTransition(async () => {
      try {
        const res = await reiniciarSessaoSandbox({
          sessaoId: sessaoRef.current,
          versao,
          tipoCasoId: tipoSelecionado?.id ?? null,
          tipoCasoLabel: tipoSelecionado?.label ?? null,
          documentos: tipoSelecionado?.documentos ?? [],
          escritorioNome,
        });
        sessaoRef.current = res.sessaoId;
        setSessaoId(res.sessaoId);
        setMessages(res.messages);
        setEncaminhar(false);
        setProximoDoc(tipoSelecionado?.documentos[0] ?? null);
        setModelLabel(null);
        setDraft("");
        setAwaitingReply(false);
        clearPendingMedia();
        setBootError(null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Falha ao reiniciar";
        toast.error(msg);
      }
    });
  }

  function send(textOverride?: string) {
    const text = (textOverride ?? draft).trim();
    const media = pendingMedia;
    if (
      (!text && !media) ||
      !sessaoId ||
      pending ||
      booting ||
      awaitingReply
    ) {
      return;
    }

    const draftSnapshot = textOverride === undefined ? draft : "";
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const optimistic: SandboxMessage = {
      id: optimisticId,
      role: "user",
      content: text,
      media_kind: media?.kind ?? null,
      media_url: media?.previewUrl ?? null,
      media_mime: media?.mimeType ?? null,
      transcript: null,
      created_at: new Date().toISOString(),
    };
    const blobToRevoke = media?.previewUrl ?? null;

    setDraft("");
    clearPendingMedia({ revoke: false });
    setMessages((prev) => [...prev, optimistic]);
    setAwaitingReply(true);

    startTransition(async () => {
      try {
        const result = await enviarMensagemSandbox({
          sessaoId,
          text: text || undefined,
          media: media
            ? {
                kind: media.kind,
                base64: media.base64,
                mimeType: media.mimeType,
                fileName: media.fileName,
              }
            : null,
          escritorioNome,
          documentos: tipoSelecionado?.documentos ?? [],
        });
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticId),
          result.userMessage,
          result.assistantMessage,
        ]);
        setEncaminhar(result.meta.encaminhar);
        if (result.meta.proximoDoc) setProximoDoc(result.meta.proximoDoc);
        setModelLabel(result.meta.model);
        if (blobToRevoke?.startsWith("blob:")) {
          URL.revokeObjectURL(blobToRevoke);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Falha ao enviar";
        toast.error(msg);
        if (draftSnapshot.trim()) setDraft(draftSnapshot);
      } finally {
        setAwaitingReply(false);
      }
    });
  }

  const userCount = messages.filter((m) => m.role === "user").length;
  const busy = pending || booting || awaitingReply;
  const canSend =
    Boolean(sessaoId) &&
    !busy &&
    (Boolean(draft.trim()) || Boolean(pendingMedia));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(260px,0.85fr)]">
      <section className={cn(cardShell, "flex min-h-[28rem] flex-col p-5 sm:p-6")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#0b2148]">
              Sandbox do agente
            </h2>
            <p className="mt-0.5 text-sm text-[#64748b]">
              Conversa de teste via n8n — nada é enviado ao cliente.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
              ambiente de teste
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={btnOutline}
              disabled={busy}
              onClick={reiniciar}
            >
              <RotateCcw className="size-3.5" />
              Reiniciar
            </Button>
          </div>
        </div>

        <div
          ref={listRef}
          className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-xl border border-[#e2e8f0] bg-[#F8FAFC] p-3"
        >
          {booting && messages.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#64748b]">
              <Loader2 className="size-4 animate-spin" />
              Iniciando sessão…
            </div>
          ) : null}
          {bootError && messages.length === 0 ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
              {bootError}
            </div>
          ) : null}
          {!booting &&
          !bootError &&
          messages.length === 0 &&
          !awaitingReply ? (
            <div className="flex items-center justify-center py-16 text-sm text-[#94a3b8]">
              Envie uma mensagem para o agente responder.
            </div>
          ) : null}
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "max-w-[90%] rounded-2xl border px-3.5 py-2.5 text-sm leading-relaxed",
                m.role === "assistant"
                  ? "border-[#e2e8f0] bg-white text-[#0f172a]"
                  : "ml-auto border-[#0b2148]/20 bg-[#0b2148] text-white"
              )}
            >
              {m.role === "assistant" ? (
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#94a3b8]">
                  Agente de IA
                </p>
              ) : null}
              {m.media_kind === "image" && m.media_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.media_url}
                  alt="Anexo do teste"
                  className="mb-2 max-h-48 w-auto rounded-lg border border-white/20 object-contain"
                />
              ) : null}
              {m.media_kind === "audio" && m.media_url ? (
                <audio
                  controls
                  src={m.media_url}
                  className="mb-2 w-full max-w-xs"
                />
              ) : null}
              {m.media_kind === "documento" ? (
                <p
                  className={cn(
                    "mb-1 text-xs font-medium",
                    m.role === "user" ? "text-white/90" : "text-[#64748b]"
                  )}
                >
                  Documento anexado
                </p>
              ) : null}
              {m.transcript && m.role === "user" ? (
                <p
                  className={cn(
                    "mb-1 text-xs italic",
                    m.role === "user" ? "text-white/80" : "text-[#64748b]"
                  )}
                >
                  {m.media_kind === "image"
                    ? "Descrição"
                    : m.media_kind === "documento"
                      ? "Texto extraído"
                      : "Transcrição"}
                  : {m.transcript.length > 280
                      ? `${m.transcript.slice(0, 280)}…`
                      : m.transcript}
                </p>
              ) : null}
              {m.content ? (
                <p className="whitespace-pre-wrap">{m.content}</p>
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
          {awaitingReply ? (
            <div
              className="flex max-w-[4.5rem] items-center justify-center gap-1 rounded-2xl border border-[#e2e8f0] bg-white px-3.5 py-3"
              role="status"
              aria-label="Agente respondendo"
            >
              <span className="size-1.5 animate-bounce rounded-full bg-[#0b2148]/35 [animation-delay:-0.3s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-[#0b2148]/45 [animation-delay:-0.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-[#0b2148]/55" />
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={busy || !sessaoId}
              onClick={() => send(chip)}
              className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs font-medium text-[#0b2148] hover:border-[#0b2148]/30 hover:bg-[#F8FAFC] disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>

        {pendingMedia ? (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#e2e8f0] bg-[#F8FAFC] px-3 py-2">
            {pendingMedia.kind === "image" && pendingMedia.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pendingMedia.previewUrl}
                alt="Prévia"
                className="h-12 w-12 rounded-lg object-cover"
              />
            ) : pendingMedia.kind === "audio" && pendingMedia.previewUrl ? (
              <audio controls src={pendingMedia.previewUrl} className="h-8 max-w-[12rem]" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[#e2e8f0] bg-white">
                <FileText className="size-5 text-[#0b2148]" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-[#0b2148]">
                {pendingMedia.fileName}
              </p>
              <p className="text-[10px] text-[#94a3b8]">
                {pendingMedia.kind === "image"
                  ? "Imagem"
                  : pendingMedia.kind === "audio"
                    ? "Áudio"
                    : "Documento"}{" "}
                anexado
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-[#64748b]"
              onClick={() => clearPendingMedia()}
              aria-label="Remover anexo"
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : null}

        <div className="mt-3 flex items-end gap-2">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void onPickFile(e.target.files?.[0], "image");
              e.target.value = "";
            }}
          />
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              void onPickFile(e.target.files?.[0], "audio");
              e.target.value = "";
            }}
          />
          <input
            ref={docInputRef}
            type="file"
            accept=".pdf,.txt,.md,.doc,.docx,application/pdf,text/plain"
            className="hidden"
            onChange={(e) => {
              void onPickFile(e.target.files?.[0], "documento");
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={iconBtn}
            disabled={busy || !sessaoId}
            title="Anexar imagem"
            aria-label="Anexar imagem"
            onClick={() => imageInputRef.current?.click()}
          >
            <ImagePlus className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={iconBtn}
            disabled={busy || !sessaoId}
            title="Anexar áudio"
            aria-label="Anexar áudio"
            onClick={() => audioInputRef.current?.click()}
          >
            <Mic className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={iconBtn}
            disabled={busy || !sessaoId}
            title="Anexar documento"
            aria-label="Anexar documento"
            onClick={() => docInputRef.current?.click()}
          >
            <FileText className="size-4" />
          </Button>
          <Textarea
            className={cn(inputShell, "min-h-[44px] flex-1 resize-none")}
            placeholder="Escreva como se fosse o cliente..."
            value={draft}
            disabled={busy && !sessaoId}
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
            className={cn(btnPrimary, "self-end")}
            disabled={!canSend}
            onClick={() => send()}
          >
            {awaitingReply ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Enviar
          </Button>
        </div>
      </section>

      <div className="space-y-4">
        <section className={cn(cardShell, "p-5")}>
          <h2 className="text-base font-bold text-[#0b2148]">
            Cenário do teste
          </h2>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                Tipo de caso simulado
              </label>
              <select
                className={cn(
                  "h-9 w-full rounded-lg border px-2.5 text-sm outline-none",
                  inputShell
                )}
                value={tipoId}
                onChange={(e) => {
                  const id = e.target.value;
                  setTipoId(id);
                  const t =
                    ativos.find((x) => x.id === id || x.chave === id) ??
                    tipos.find((x) => x.id === id || x.chave === id);
                  setProximoDoc(t?.documentos[0] ?? null);
                }}
              >
                {(ativos.length ? ativos : tipos).map((t) => (
                  <option key={t.id ?? t.chave} value={t.id ?? t.chave}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                Versão em teste
              </label>
              <div className="flex w-full rounded-full border border-[#e2e8f0] bg-[#e2e8f0] p-0.5">
                {(
                  [
                    ["rascunho", "Rascunho"],
                    ["publicada", "Publicada"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setVersao(value)}
                    className={cn(
                      "flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                      versao === value
                        ? "bg-[#0b2148] text-white shadow-sm"
                        : "bg-transparent text-[#64748b] hover:text-[#0b2148]"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[#94a3b8]">
                Trocar a versão reinicia a sessão com o prompt correspondente.
              </p>
            </div>
          </div>
        </section>

        <section className={cn(cardShell, "p-5")}>
          <h2 className="text-base font-bold text-[#0b2148]">
            O que o agente entendeu
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#64748b]">Tipo de caso</dt>
              <dd className="font-semibold text-emerald-700">
                {tipoSelecionado?.label ?? "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#64748b]">Próximo documento</dt>
              <dd className="text-right font-semibold text-emerald-700">
                {proximoDoc ?? "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#64748b]">Encaminhar humano</dt>
              <dd className="font-semibold text-[#0f172a]">
                {encaminhar ? "sim" : "não"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#64748b]">Mensagens no teste</dt>
              <dd className="font-semibold text-[#0f172a]">{userCount}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#64748b]">Modelo</dt>
              <dd className="truncate text-right font-semibold text-[#0f172a]">
                {modelLabel ?? "—"}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-[#94a3b8]">
            Respostas vêm do n8n com o prompt {versao}. Mídia é pré-processada
            (Whisper/visão) antes do webhook. Dados de teste expiram em 7 dias.
            Nada entra no funil nem gera aprovação.
          </p>
        </section>
      </div>
    </div>
  );
}
