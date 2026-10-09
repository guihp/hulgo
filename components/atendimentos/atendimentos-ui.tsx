"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Contact,
  FileText,
  ImageIcon,
  MapPin,
  MessageSquare,
  Mic,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { marcarConversaLida, setControleIA } from "@/lib/actions/conversas";
import type { Tables } from "@/types/database";
import { CASO_STATUS } from "@/lib/constants";
import {
  cleanMessageText,
  contactInitials,
  isAgentMessage,
  isClientMessage,
  parseContactPayload,
  parseLocationPayload,
  resolveMediaDisplayKind,
} from "@/lib/utils/messages";
import {
  formatRelative,
  formatChatTime,
  formatChatDateSeparator,
  isActiveConversation,
} from "@/lib/utils/dates";
import { formatPhone, phoneToContactNorm } from "@/lib/utils/phone";
import { ChatComposer } from "@/components/atendimentos/chat-composer";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toastErroAcao } from "@/lib/client/erros";

type Mensagem = Tables<"mensagens">;

export type CasoMeta = {
  status: string | null;
  beneficio: string | null;
  cpf: string | null;
};

export type CasoMetaMap = Record<string, CasoMeta>;

type Conversation = {
  contact_norm: string;
  phone: string;
  displayName: string | null;
  lastMessage: string;
  lastAt: string;
  lastType: string | null;
  active: boolean;
  unread: number;
  casoStatus: string | null;
  beneficio: string | null;
  cpf: string | null;
  pedeHumano: boolean;
};

type ReadMap = Record<string, string>;
type ContactNameMap = Record<string, string>;
type FiltroPill = "ativas" | "humano" | "todas";

function mergeMessageAsc(list: Mensagem[], msg: Mensagem): Mensagem[] {
  if (
    list.some(
      (m) =>
        m.id === msg.id ||
        (m.mensagem_id && msg.mensagem_id && m.mensagem_id === msg.mensagem_id)
    )
  ) {
    return list;
  }
  return [...list, msg].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function prependMessageDesc(list: Mensagem[], msg: Mensagem): Mensagem[] {
  if (
    list.some(
      (m) =>
        m.id === msg.id ||
        (m.mensagem_id && msg.mensagem_id && m.mensagem_id === msg.mensagem_id)
    )
  ) {
    return list;
  }
  return [msg, ...list];
}

function lookupCaso(meta: CasoMetaMap, contact: string): CasoMeta | undefined {
  if (!contact) return undefined;
  return (
    meta[contact] ??
    meta[phoneToContactNorm(contact)] ??
    meta[contact.replace(/\D/g, "")]
  );
}

function casoStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return CASO_STATUS.find((s) => s.value === status)?.label ?? status;
}

function shortStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  if (status === "atendimento_humano") return "pede humano";
  if (status === "em_atendimento") return "Em atendimento";
  return casoStatusLabel(status);
}

function statusPillClasses(status: string | null | undefined) {
  if (status === "atendimento_humano") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (status === "em_atendimento") {
    return "border-[#0b2148]/20 bg-[#0b2148]/8 text-[#0b2148]";
  }
  if (status === "aguardando_analise" || status === "aguardando_aprovacao") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function groupConversations(
  messages: Mensagem[],
  nameMap: ContactNameMap,
  readMap: ReadMap = {},
  casoMeta: CasoMetaMap = {}
): Conversation[] {
  const map = new Map<string, Conversation>();
  const unreadMap = new Map<string, number>();

  for (const msg of messages) {
    const key = msg.contact_norm ?? "";
    if (!key) continue;

    if (msg.type !== "bot" && msg.type !== "ai") {
      const lidaEm = readMap[key];
      if (!lidaEm || new Date(msg.created_at) > new Date(lidaEm)) {
        unreadMap.set(key, (unreadMap.get(key) ?? 0) + 1);
      }
    }

    const existing = map.get(key);
    const mediaKind = resolveMediaDisplayKind(msg.mensage_type, msg.conteudo_media);
    const mediaLabel =
      mediaKind === "audio"
        ? "[áudio]"
        : mediaKind === "video"
          ? "[vídeo]"
          : mediaKind === "document"
            ? "[documento]"
            : "[mídia]";
    const text =
      cleanMessageText(msg.text) ||
      (msg.conteudo_media ? mediaLabel : "");
    if (!existing || new Date(msg.created_at) > new Date(existing.lastAt)) {
      const caso = lookupCaso(casoMeta, key);
      map.set(key, {
        contact_norm: key,
        phone: msg.phone ?? key,
        displayName: nameMap[key] ?? nameMap[phoneToContactNorm(key)] ?? null,
        lastMessage: text,
        lastAt: msg.created_at,
        lastType: msg.type,
        active: isActiveConversation(msg.created_at),
        unread: 0,
        casoStatus: caso?.status ?? null,
        beneficio: caso?.beneficio ?? null,
        cpf: caso?.cpf ?? null,
        pedeHumano: caso?.status === "atendimento_humano",
      });
    }
  }

  return Array.from(map.values())
    .map((c) => ({ ...c, unread: unreadMap.get(c.contact_norm) ?? 0 }))
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
}

function groupMessagesByDate(messages: Mensagem[]) {
  const groups: { dateLabel: string; messages: Mensagem[] }[] = [];
  let currentLabel = "";

  for (const msg of messages) {
    const label = formatChatDateSeparator(msg.created_at);
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ dateLabel: label, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}

function fileNameFromUrl(url: string): string {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const name = path.split("/").filter(Boolean).pop();
    return name || "Arquivo";
  } catch {
    return "Arquivo";
  }
}

function MediaPreview({ msg, isClient }: { msg: Mensagem; isClient: boolean }) {
  const [imageOpen, setImageOpen] = useState(false);
  const type = msg.mensage_type ?? "";
  const url = msg.conteudo_media;
  const shell = isClient
    ? "border-[#e2e8f0] bg-white/70"
    : "border-[#0b2148]/15 bg-white/50";

  if (type === "location") {
    const location = parseLocationPayload(msg.text);
    if (!location) return null;
    const mapsUrl = `https://maps.google.com/?q=${location.lat},${location.lng}`;
    return (
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("mb-1 block rounded-lg border p-2", shell)}
      >
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <div className="min-w-0">
            <p className="font-medium text-[#0b2148]">
              {location.name?.trim() || "Localização"}
            </p>
            {location.address?.trim() ? (
              <p className="text-xs text-[#64748B]">{location.address}</p>
            ) : null}
            <p className="mt-1 text-xs text-[#0b2148] underline opacity-80">
              Abrir no Google Maps
            </p>
          </div>
        </div>
      </a>
    );
  }

  if (type === "contact") {
    const contact = parseContactPayload(msg.text);
    if (!contact) return null;
    return (
      <div className={cn("mb-1 rounded-lg border p-2", shell)}>
        <div className="flex items-start gap-2">
          <Contact className="mt-0.5 h-4 w-4 shrink-0 text-[#64748B]" />
          <div className="min-w-0">
            <p className="font-medium text-[#0b2148]">{contact.fullName}</p>
            <p className="text-xs text-[#64748B]">{formatPhone(contact.phone)}</p>
            {contact.organization?.trim() ? (
              <p className="text-xs text-[#94a3b8]">{contact.organization}</p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (type === "sticker" && url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt="Sticker"
        className="mb-1 max-h-40 max-w-[160px] object-contain"
      />
    );
  }

  if (!url) return null;

  const mediaKind = resolveMediaDisplayKind(type, url);

  if (mediaKind === "image") {
    return (
      <>
        <button
          type="button"
          onClick={() => setImageOpen(true)}
          className="mb-1 block cursor-zoom-in rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-[#0b2148]/40"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Mídia"
            className="max-h-48 max-w-full rounded-lg object-cover"
          />
        </button>
        <Dialog open={imageOpen} onOpenChange={setImageOpen}>
          <DialogContent
            showCloseButton
            className="max-h-[min(92vh,920px)] w-auto max-w-[min(96vw,1100px)] border-[#e2e8f0] bg-white p-3 sm:max-w-[min(96vw,1100px)]"
          >
            <DialogTitle className="sr-only">Visualizar mídia</DialogTitle>
            <DialogDescription className="sr-only">
              Imagem ampliada da conversa. Feche com Esc, pelo botão ou clicando fora.
            </DialogDescription>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt="Mídia"
              className="mx-auto max-h-[min(80vh,820px)] max-w-full rounded-lg object-contain"
            />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block text-center text-xs font-medium text-[#0b2148] underline underline-offset-2 opacity-80 hover:opacity-100"
            >
              Abrir original
            </a>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (mediaKind === "audio") {
    return (
      <div
        className={cn(
          "mb-1 flex min-w-[220px] items-center gap-2 rounded-lg border px-2 py-1.5",
          shell
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0b2148] text-white">
          <Mic className="h-3.5 w-3.5" />
        </span>
        <audio controls src={url} className="max-w-full flex-1" preload="metadata" />
      </div>
    );
  }

  if (mediaKind === "video") {
    return (
      <div className="mb-1 max-w-full">
        <video
          controls
          src={url}
          className="max-h-48 max-w-full rounded-lg"
          preload="metadata"
        />
      </div>
    );
  }

  if (mediaKind === "document") {
    const name = fileNameFromUrl(url);
    const ext = name.includes(".")
      ? name.split(".").pop()!.toUpperCase()
      : "DOC";
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "mb-1 flex items-center gap-2.5 rounded-lg border p-2.5 transition hover:border-[#0b2148]/30",
          shell
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#0b2148]/10 text-[#0b2148]">
          <FileText className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-[#0b2148]">
            {name}
          </span>
          <span className="text-[11px] text-[#64748B]">{ext}</span>
        </span>
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1 flex items-center gap-1 text-xs text-[#0b2148] underline opacity-90"
    >
      <ImageIcon className="h-3.5 w-3.5" />
      Ver mídia
    </a>
  );
}

function ConversationList({
  conversations,
  selectedContact,
  search,
  onSearchChange,
  onSelect,
  inboxEmpty,
}: {
  conversations: Conversation[];
  selectedContact: string | null;
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (contact: string) => void;
  inboxEmpty?: boolean;
}) {
  const filtered = conversations.filter((c) => {
    const q = search.toLowerCase();
    return (
      !q ||
      c.phone.includes(q.replace(/\D/g, "")) ||
      c.displayName?.toLowerCase().includes(q) ||
      c.lastMessage.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-[#e2e8f0] bg-[#F8FAFC]">
      <div className="border-b border-[#e2e8f0] bg-white p-3">
        <Input
          placeholder="Buscar conversa..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-10 border-[#e2e8f0] bg-white text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <MessageSquare className="mb-2 h-8 w-8 text-[#94a3b8]/60" />
              <p className="text-sm text-[#64748B]">
                {inboxEmpty
                  ? "Nenhuma conversa"
                  : "Nenhuma conversa neste filtro"}
              </p>
              {inboxEmpty ? (
                <p className="mt-1 max-w-[240px] text-xs text-[#94a3b8]">
                  As mensagens do WhatsApp aparecerão aqui.
                </p>
              ) : null}
            </div>
          ) : (
            <ul className="space-y-2 p-2">
              {filtered.map((c) => {
                const selected = selectedContact === c.contact_norm;
                const statusText = shortStatusLabel(c.casoStatus);
                return (
                  <li key={c.contact_norm}>
                    <button
                      type="button"
                      onClick={() => onSelect(c.contact_norm)}
                      className={cn(
                        "relative w-full rounded-xl border bg-white p-3 text-left shadow-sm transition hover:shadow-md",
                        selected
                          ? "border-2 border-[#0b2148] ring-1 ring-[#0b2148]/10"
                          : "border-[#e2e8f0] hover:border-[#0b2148]/25"
                      )}
                    >
                      {c.unread > 0 ? (
                        <span className="absolute right-2.5 top-2.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0b2148] px-1.5 text-[11px] font-bold text-white">
                          {c.unread > 99 ? "99+" : c.unread}
                        </span>
                      ) : null}
                      <div className="flex gap-3">
                        <Avatar className="h-11 w-11 shrink-0">
                          <AvatarFallback className="bg-[#0b2148]/10 text-sm font-semibold text-[#0b2148]">
                            {contactInitials(c.phone, c.displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1 pr-6">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate font-semibold text-[#0b2148]">
                              {c.displayName ?? formatPhone(c.phone)}
                            </p>
                            <span className="shrink-0 text-[11px] text-[#94a3b8]">
                              {formatRelative(c.lastAt)}
                            </span>
                          </div>
                          <p
                            className={cn(
                              "mt-0.5 truncate text-sm text-[#64748B]",
                              c.unread > 0 && "font-medium text-[#334155]"
                            )}
                          >
                            {c.lastMessage || "—"}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {c.active && !c.pedeHumano ? (
                              <span className="rounded-full border border-[#0b2148]/20 bg-[#0b2148]/8 px-2 py-0.5 text-[11px] font-medium text-[#0b2148]">
                                Em atendimento
                              </span>
                            ) : null}
                            {statusText &&
                            !(c.active && c.casoStatus === "em_atendimento") ? (
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                  statusPillClasses(c.casoStatus)
                                )}
                              >
                                {statusText}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

function ConversationThread({
  contactNorm,
  phone,
  displayName,
  casoStatus,
  beneficio,
  cpf,
  initialMessages,
  onBack,
  showBack,
  onMessageSent,
  onListRefresh,
  whatsappInstancia,
  agentOn,
  onAgentChange,
}: {
  contactNorm: string;
  phone: string;
  displayName: string | null;
  casoStatus: string | null;
  beneficio: string | null;
  cpf: string | null;
  initialMessages: Mensagem[];
  onBack?: () => void;
  showBack?: boolean;
  onMessageSent?: (msg: Mensagem) => void;
  onListRefresh?: () => void;
  whatsappInstancia?: string;
  agentOn: boolean;
  onAgentChange: (on: boolean) => void;
}) {
  const [messages, setMessages] = useState(
    [...initialMessages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
  );
  const [agentBusy, setAgentBusy] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("mensagens")
      .select("*")
      .eq("contact_norm", contactNorm)
      .order("created_at", { ascending: true });
    if (data) setMessages(data);
  }, [contactNorm]);

  useEffect(() => {
    setMessages(
      [...initialMessages].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
    );
  }, [contactNorm, initialMessages]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`mensagens-${contactNorm}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mensagens",
          filter: `contact_norm=eq.${contactNorm}`,
        },
        () => refresh()
      )
      .subscribe();
    const interval = setInterval(refresh, 45000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [contactNorm, refresh]);

  const groups = useMemo(() => groupMessagesByDate(messages), [messages]);

  const handleComposerSent = useCallback(
    (msg: Mensagem, iaPausada?: boolean) => {
      setMessages((prev) => mergeMessageAsc(prev, msg));
      onMessageSent?.(msg);
      onListRefresh?.();
      if (iaPausada) onAgentChange(false);
    },
    [onAgentChange, onListRefresh, onMessageSent]
  );

  const toggleAgent = async () => {
    if (agentBusy) return;
    setAgentBusy(true);
    const next = !agentOn;
    try {
      await setControleIA({
        acao: next ? "despausar" : "pausar",
        telefone: phone,
        instancia: whatsappInstancia,
      });
      onAgentChange(next);
      toast.success(next ? "Agente ligado" : "Agente pausado nesta conversa");
    } catch (err) {
      toastErroAcao(err, "Falha ao controlar a IA");
    } finally {
      setAgentBusy(false);
    }
  };

  const fichaHref = cpf
    ? `/clientes/${cpf}`
    : `/clientes/contato/${encodeURIComponent(contactNorm)}`;
  const statusText = shortStatusLabel(casoStatus);
  const benefitLabel = beneficio?.trim() || "Benefício não identificado";

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F1F5F9]">
      <header className="flex shrink-0 items-center gap-3 border-b border-[#e2e8f0] bg-white px-4 py-3">
        {showBack && onBack && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg p-1.5 text-[#0b2148] hover:bg-[#F1F5F9] lg:hidden"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-[#0b2148]/10 font-semibold text-[#0b2148]">
              {contactInitials(phone, displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-semibold text-[#0b2148]">
              {displayName ?? formatPhone(phone)}
            </p>
            <p className="truncate text-xs text-[#64748B]">
              {formatPhone(phone)}
              <span className="mx-1.5 text-[#cbd5e1]">·</span>
              {benefitLabel}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {statusText ? (
            <span
              className={cn(
                "hidden rounded-full border px-2.5 py-1 text-xs font-medium sm:inline-flex",
                statusPillClasses(casoStatus)
              )}
            >
              {statusText}
            </span>
          ) : (
            <span className="hidden rounded-full border border-[#0b2148]/20 bg-[#0b2148]/8 px-2.5 py-1 text-xs font-medium text-[#0b2148] sm:inline-flex">
              Em atendimento
            </span>
          )}
          <Button
            type="button"
            size="sm"
            disabled={agentBusy}
            onClick={() => void toggleAgent()}
            className={cn(
              "h-8 rounded-full px-3 text-xs font-medium",
              agentOn
                ? "bg-[#0b2148] text-white hover:bg-[#163a7a]"
                : "border border-[#e2e8f0] bg-white text-[#64748B] hover:border-[#0b2148]/30 hover:text-[#0b2148]"
            )}
            variant={agentOn ? "default" : "outline"}
          >
            {agentOn ? "Agente ligado" : "Agente desligado"}
          </Button>
          <Link
            href={fichaHref}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "h-8 rounded-full border-[#e2e8f0] px-3 text-xs font-medium text-[#0b2148] hover:border-[#0b2148]/30 hover:bg-[#0b2148]/5"
            )}
          >
            Ver ficha
          </Link>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="space-y-4 p-4">
            {groups.map((group) => (
              <div key={group.dateLabel}>
                <div className="mb-3 flex justify-center">
                  <span className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs text-[#64748B] shadow-sm">
                    {group.dateLabel}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.messages.map((msg) => {
                    const isClient = isClientMessage(msg.type);
                    const isAgent = isAgentMessage(msg.type);
                    const messageType = msg.mensage_type ?? "";
                    const location =
                      messageType === "location"
                        ? parseLocationPayload(msg.text)
                        : null;
                    const contact =
                      messageType === "contact"
                        ? parseContactPayload(msg.text)
                        : null;
                    const text =
                      messageType === "location" || messageType === "contact"
                        ? ""
                        : cleanMessageText(msg.text);
                    const hasContent = Boolean(
                      text || msg.conteudo_media || location || contact
                    );
                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex",
                          isClient ? "justify-start" : "justify-end"
                        )}
                      >
                        <div
                          className={cn(
                            "relative max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                            isClient
                              ? "rounded-tl-md border border-[#e2e8f0] bg-white text-[#0f172a]"
                              : "rounded-tr-md border border-[#0b2148]/10 bg-[#0b2148]/8 text-[#0b2148]"
                          )}
                        >
                          {isAgent ? (
                            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#0b2148]/70">
                              Agente de IA
                            </p>
                          ) : null}
                          <MediaPreview msg={msg} isClient={isClient} />
                          {text ? (
                            <p className="whitespace-pre-wrap break-words">
                              {text}
                            </p>
                          ) : null}
                          {!hasContent && (
                            <p className="italic text-[#94a3b8]">—</p>
                          )}
                          <p
                            className={cn(
                              "mt-1 text-right text-[10px]",
                              isClient ? "text-[#94a3b8]" : "text-[#0b2148]/50"
                            )}
                          >
                            {formatChatTime(msg.created_at)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="shrink-0">
        <ChatComposer
          phone={phone}
          contactNorm={contactNorm}
          instancia={whatsappInstancia ?? ""}
          onSent={handleComposerSent}
        />
      </div>
    </div>
  );
}

function EmptyThread({ inboxEmpty = false }: { inboxEmpty?: boolean }) {
  return (
    <div className="hidden h-full flex-col items-center justify-center bg-[#F1F5F9] lg:flex">
      <MessageSquare className="mb-3 h-12 w-12 text-[#94a3b8]/50" />
      {inboxEmpty ? (
        <>
          <p className="font-medium text-[#64748B]">Aguardando mensagens</p>
          <p className="mt-1 max-w-sm px-6 text-center text-sm text-[#94a3b8]">
            As mensagens do WhatsApp aparecerão aqui.
          </p>
        </>
      ) : (
        <p className="text-[#64748B]">
          Selecione uma conversa para ver as mensagens
        </p>
      )}
    </div>
  );
}

export function AtendimentosPanel({
  initialMessages,
  initialContact,
  contactNames = {},
  whatsappInstancia,
  casoMeta = {},
}: {
  initialMessages: Mensagem[];
  initialContact?: string | null;
  contactNames?: ContactNameMap;
  whatsappInstancia?: string;
  casoMeta?: CasoMetaMap;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<FiltroPill>("todas");
  const [selectedContact, setSelectedContact] = useState<string | null>(
    initialContact ?? null
  );
  const [mobileShowThread, setMobileShowThread] = useState(!!initialContact);
  const [readMap, setReadMap] = useState<ReadMap>({});
  const [agentByContact, setAgentByContact] = useState<Record<string, boolean>>(
    {}
  );

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("app_conversas_lidas")
      .select("contact_norm, lida_em")
      .then(({ data }) => {
        if (!data) return;
        const map: ReadMap = {};
        for (const r of data) map[r.contact_norm] = r.lida_em;
        setReadMap(map);
      });
  }, []);

  useEffect(() => {
    if (!selectedContact) return;
    const agora = new Date().toISOString();
    setReadMap((prev) => ({ ...prev, [selectedContact]: agora }));
    marcarConversaLida(selectedContact).catch(() => {});
  }, [selectedContact, messages]);

  const conversations = useMemo(
    () => groupConversations(messages, contactNames, readMap, casoMeta),
    [messages, contactNames, readMap, casoMeta]
  );

  const counts = useMemo(() => {
    const ativas = conversations.filter((c) => c.active).length;
    const humano = conversations.filter((c) => c.pedeHumano).length;
    return { ativas, humano, todas: conversations.length };
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    switch (filtro) {
      case "ativas":
        return conversations.filter((c) => c.active);
      case "humano":
        return conversations.filter((c) => c.pedeHumano);
      default:
        return conversations;
    }
  }, [conversations, filtro]);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("mensagens")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data) setMessages(data);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("mensagens-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mensagens" },
        () => refresh()
      )
      .subscribe();
    const interval = setInterval(refresh, 45000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [refresh]);

  const handleSelect = (contact: string) => {
    setSelectedContact(contact);
    setMobileShowThread(true);
    router.replace(`/atendimentos?contact=${encodeURIComponent(contact)}`, {
      scroll: false,
    });
  };

  const handleBack = () => {
    setMobileShowThread(false);
    router.replace("/atendimentos", { scroll: false });
  };

  const handleMessageSent = useCallback((msg: Mensagem) => {
    setMessages((prev) => prependMessageDesc(prev, msg));
  }, []);

  const selectedConv = conversations.find(
    (c) => c.contact_norm === selectedContact
  );
  const threadMessages = useMemo(
    () =>
      selectedContact
        ? messages
            .filter((m) => m.contact_norm === selectedContact)
            .sort(
              (a, b) =>
                new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime()
            )
        : [],
    [messages, selectedContact]
  );

  const inboxEmpty = conversations.length === 0;
  const pills: { key: FiltroPill; label: string; count: number }[] = [
    { key: "ativas", label: "Ativas", count: counts.ativas },
    { key: "humano", label: "Pedem humano", count: counts.humano },
    { key: "todas", label: "Todas", count: counts.todas },
  ];

  const agentOn =
    selectedContact != null
      ? (agentByContact[selectedContact] ?? true)
      : true;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0b2148]">
            Atendimentos
          </h1>
          <p className="text-sm text-[#64748B]">
            Conversas do WhatsApp conduzidas pelo agente de IA
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pills.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setFiltro(p.key)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                filtro === p.key
                  ? "border-[#0b2148] bg-[#0b2148] text-white shadow-sm"
                  : "border-[#e2e8f0] bg-white text-[#64748B] hover:border-[#0b2148]/30 hover:text-[#0b2148]"
              )}
            >
              {p.label} ({p.count})
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
        <div className="grid min-h-0 flex-1 lg:grid-cols-[340px_1fr]">
          <div
            className={cn(
              "h-full min-h-0",
              mobileShowThread ? "hidden lg:block" : "block"
            )}
          >
            <ConversationList
              conversations={filteredConversations}
              selectedContact={selectedContact}
              search={search}
              onSearchChange={setSearch}
              onSelect={handleSelect}
              inboxEmpty={inboxEmpty}
            />
          </div>

          <div
            className={cn(
              "h-full min-h-0",
              mobileShowThread ? "block" : "hidden lg:block"
            )}
          >
            {selectedContact && selectedConv ? (
              <ConversationThread
                contactNorm={selectedContact}
                phone={selectedConv.phone}
                displayName={selectedConv.displayName}
                casoStatus={selectedConv.casoStatus}
                beneficio={selectedConv.beneficio}
                cpf={selectedConv.cpf}
                initialMessages={threadMessages}
                showBack
                onBack={handleBack}
                onMessageSent={handleMessageSent}
                onListRefresh={refresh}
                whatsappInstancia={whatsappInstancia}
                agentOn={agentOn}
                onAgentChange={(on) =>
                  setAgentByContact((prev) => ({
                    ...prev,
                    [selectedContact]: on,
                  }))
                }
              />
            ) : (
              <EmptyThread inboxEmpty={inboxEmpty} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** @deprecated Use AtendimentosPanel */
export function AtendimentosList({
  initialMessages,
}: {
  initialMessages: Mensagem[];
}) {
  return <AtendimentosPanel initialMessages={initialMessages} />;
}

/** @deprecated Use AtendimentosPanel */
export function ConversationThreadExport({
  contactNorm,
  initialMessages,
}: {
  contactNorm: string;
  initialMessages: Mensagem[];
}) {
  const phone = initialMessages[0]?.phone ?? contactNorm;
  return (
    <ConversationThread
      contactNorm={contactNorm}
      phone={phone}
      displayName={null}
      casoStatus={null}
      beneficio={null}
      cpf={null}
      initialMessages={initialMessages}
      agentOn
      onAgentChange={() => {}}
    />
  );
}

export { ConversationThreadExport as ConversationThread };
