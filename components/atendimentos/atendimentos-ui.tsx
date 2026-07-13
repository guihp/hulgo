"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Contact, FileText, ImageIcon, MapPin, MessageSquare, Mic, Video } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { marcarConversaLida } from "@/lib/actions/conversas";
import type { Tables } from "@/types/database";
import {
  cleanMessageText,
  contactInitials,
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
import { formatPhone } from "@/lib/utils/phone";
import { ChatComposer } from "@/components/atendimentos/chat-composer";
import { EmptyState } from "@/components/shared/empty-state";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Mensagem = Tables<"mensagens">;

type Conversation = {
  contact_norm: string;
  phone: string;
  displayName: string | null;
  lastMessage: string;
  lastAt: string;
  lastType: string | null;
  active: boolean;
  unread: number;
};

type ReadMap = Record<string, string>; // contact_norm -> lida_em (ISO)

type ContactNameMap = Record<string, string>;

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

function groupConversations(
  messages: Mensagem[],
  nameMap: ContactNameMap,
  readMap: ReadMap = {}
): Conversation[] {
  const map = new Map<string, Conversation>();
  const unreadMap = new Map<string, number>();

  for (const msg of messages) {
    const key = msg.contact_norm ?? "";
    if (!key) continue;

    // não lida = mensagem do cliente mais nova que a última leitura
    if (msg.type !== "bot") {
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
      map.set(key, {
        contact_norm: key,
        phone: msg.phone ?? key,
        displayName: nameMap[key] ?? null,
        lastMessage: text,
        lastAt: msg.created_at,
        lastType: msg.type,
        active: isActiveConversation(msg.created_at),
        unread: 0,
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

function MediaPreview({ msg }: { msg: Mensagem }) {
  const type = msg.mensage_type ?? "";
  const url = msg.conteudo_media;

  if (type === "location") {
    const location = parseLocationPayload(msg.text);
    if (!location) return null;
    const mapsUrl = `https://maps.google.com/?q=${location.lat},${location.lng}`;
    return (
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-1 block rounded-lg border border-black/10 bg-background/40 p-2 dark:border-white/10"
      >
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <div className="min-w-0">
            <p className="font-medium">
              {location.name?.trim() || "Localização"}
            </p>
            {location.address?.trim() ? (
              <p className="text-xs opacity-80">{location.address}</p>
            ) : null}
            <p className="mt-1 text-xs underline opacity-70">Abrir no Google Maps</p>
          </div>
        </div>
      </a>
    );
  }

  if (type === "contact") {
    const contact = parseContactPayload(msg.text);
    if (!contact) return null;
    return (
      <div className="mb-1 rounded-lg border border-black/10 bg-background/40 p-2 dark:border-white/10">
        <div className="flex items-start gap-2">
          <Contact className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
          <div className="min-w-0">
            <p className="font-medium">{contact.fullName}</p>
            <p className="text-xs opacity-80">{formatPhone(contact.phone)}</p>
            {contact.organization?.trim() ? (
              <p className="text-xs opacity-70">{contact.organization}</p>
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
      <a href={url} target="_blank" rel="noopener noreferrer" className="mb-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Mídia"
          className="max-h-48 max-w-full rounded-lg object-cover"
        />
      </a>
    );
  }

  if (mediaKind === "audio") {
    return (
      <div className="mb-1 flex min-w-[220px] items-center gap-2">
        <Mic className="h-4 w-4 shrink-0 opacity-70" />
        <audio controls src={url} className="max-w-full" preload="metadata" />
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
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-1 flex items-center gap-2 rounded-lg border border-black/10 bg-background/40 p-2 text-xs underline dark:border-white/10"
      >
        <FileText className="h-4 w-4 shrink-0 opacity-70" />
        <span>Abrir documento</span>
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1 flex items-center gap-1 text-xs underline opacity-90"
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
}: {
  conversations: Conversation[];
  selectedContact: string | null;
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (contact: string) => void;
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
    <div className="flex h-full min-h-0 flex-col border-r bg-card">
      <div className="border-b p-3">
        <Input
          placeholder="Buscar conversa..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
        {filtered.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            Nenhuma conversa encontrada
          </p>
        ) : (
          <ul>
            {filtered.map((c) => (
              <li key={c.contact_norm}>
                <button
                  type="button"
                  onClick={() => onSelect(c.contact_norm)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b px-3 py-3 text-left transition-colors hover:bg-muted/50",
                    selectedContact === c.contact_norm && "bg-muted"
                  )}
                >
                  <Avatar className="h-11 w-11 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary text-sm">
                      {contactInitials(c.phone, c.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">
                        {c.displayName ?? formatPhone(c.phone)}
                      </p>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatRelative(c.lastAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <p
                        className={cn(
                          "truncate text-sm text-muted-foreground",
                          c.unread > 0 && "font-medium text-foreground"
                        )}
                      >
                        {c.lastMessage || "—"}
                      </p>
                      {c.unread > 0 && (
                        <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-white">
                          {c.unread > 99 ? "99+" : c.unread}
                        </span>
                      )}
                      {c.active && c.unread === 0 && (
                        <Badge variant="default" className="h-5 shrink-0 px-1.5 text-[10px]">
                          Ativa
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
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
  initialMessages,
  onBack,
  showBack,
  onMessageSent,
  onListRefresh,
  whatsappInstancia,
}: {
  contactNorm: string;
  phone: string;
  displayName: string | null;
  initialMessages: Mensagem[];
  onBack?: () => void;
  showBack?: boolean;
  onMessageSent?: (msg: Mensagem) => void;
  onListRefresh?: () => void;
  whatsappInstancia?: string;
}) {
  const [messages, setMessages] = useState(
    [...initialMessages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
  );

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
    (msg: Mensagem) => {
      setMessages((prev) => mergeMessageAsc(prev, msg));
      onMessageSent?.(msg);
      onListRefresh?.();
    },
    [onListRefresh, onMessageSent]
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#efeae2] dark:bg-[#0b141a]">
      <header className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-3">
        {showBack && onBack && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg p-1.5 hover:bg-muted lg:hidden"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <Link
          href={`/arquivos/${contactNorm}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 transition-colors hover:bg-muted/60"
          title="Ver arquivos do cliente"
        >
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary/10 text-primary">
              {contactInitials(phone, displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-semibold">
              {displayName ?? formatPhone(phone)}
            </p>
            <p className="truncate text-xs text-muted-foreground">{formatPhone(phone)}</p>
          </div>
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full bg-[url('data:image/svg+xml,%3Csvg width=%2260%22 height=%2260%22 viewBox=%220 0 60 60%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cg fill=%22none%22 fill-rule=%22evenodd%22%3E%3Cg fill=%22%23000000%22 fill-opacity=%220.03%22%3E%3Cpath d=%22M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] dark:bg-[url('data:image/svg+xml,%3Csvg width=%2260%22 height=%2260%22 viewBox=%220 0 60 60%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cg fill=%22none%22 fill-rule=%22evenodd%22%3E%3Cg fill=%22%23ffffff%22 fill-opacity=%220.04%22%3E%3Cpath d=%22M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')]">
          <div className="space-y-4 p-4">
          {groups.map((group) => (
            <div key={group.dateLabel}>
              <div className="mb-3 flex justify-center">
                <span className="rounded-lg bg-card/90 px-3 py-1 text-xs text-muted-foreground shadow-sm">
                  {group.dateLabel}
                </span>
              </div>
              <div className="space-y-1">
                {group.messages.map((msg) => {
                  const isClient = isClientMessage(msg.type);
                  const messageType = msg.mensage_type ?? "";
                  const location = messageType === "location" ? parseLocationPayload(msg.text) : null;
                  const contact = messageType === "contact" ? parseContactPayload(msg.text) : null;
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
                      className={cn("flex", isClient ? "justify-start" : "justify-end")}
                    >
                      <div
                        className={cn(
                          "relative max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm",
                          isClient
                            ? "rounded-tl-none bg-[#f0f2f5] text-foreground dark:bg-[#2a3942] dark:text-[#e9edef]"
                            : "rounded-tr-none bg-[#d9fdd3] text-foreground dark:bg-[#005c4b] dark:text-[#e9edef]"
                        )}
                      >
                        <MediaPreview msg={msg} />
                        {text ? <p className="whitespace-pre-wrap break-words">{text}</p> : null}
                        {!hasContent && (
                          <p className="italic opacity-70">—</p>
                        )}
                        <p className="mt-0.5 text-right text-[10px] opacity-60">
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

function EmptyThread() {
  return (
    <div className="hidden h-full flex-col items-center justify-center bg-muted/20 lg:flex">
      <MessageSquare className="mb-3 h-12 w-12 text-muted-foreground/40" />
      <p className="text-muted-foreground">Selecione uma conversa para ver as mensagens</p>
    </div>
  );
}

export function AtendimentosPanel({
  initialMessages,
  initialContact,
  contactNames = {},
  whatsappInstancia,
}: {
  initialMessages: Mensagem[];
  initialContact?: string | null;
  contactNames?: ContactNameMap;
  whatsappInstancia?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [search, setSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<string | null>(
    initialContact ?? null
  );
  const [mobileShowThread, setMobileShowThread] = useState(!!initialContact);
  const [readMap, setReadMap] = useState<ReadMap>({});

  // carrega as marcações de leitura do usuário (badge estilo WhatsApp)
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

  // conversa aberta continua lida mesmo com mensagem nova chegando
  useEffect(() => {
    if (!selectedContact) return;
    const agora = new Date().toISOString();
    setReadMap((prev) => ({ ...prev, [selectedContact]: agora }));
    marcarConversaLida(selectedContact).catch(() => {});
  }, [selectedContact, messages]);

  const conversations = useMemo(
    () => groupConversations(messages, contactNames, readMap),
    [messages, contactNames, readMap]
  );

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

  const selectedConv = conversations.find((c) => c.contact_norm === selectedContact);
  const threadMessages = useMemo(
    () =>
      selectedContact
        ? messages
            .filter((m) => m.contact_norm === selectedContact)
            .sort(
              (a, b) =>
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
        : [],
    [messages, selectedContact]
  );

  if (conversations.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="Nenhuma conversa"
        description="As mensagens do WhatsApp aparecerão aqui quando o n8n gravar na tabela mensagens."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="grid min-h-0 flex-1 lg:grid-cols-[360px_1fr]">
        <div
          className={cn(
            "h-full min-h-0",
            mobileShowThread ? "hidden lg:block" : "block"
          )}
        >
          <ConversationList
            conversations={conversations}
            selectedContact={selectedContact}
            search={search}
            onSearchChange={setSearch}
            onSelect={handleSelect}
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
              initialMessages={threadMessages}
              showBack
              onBack={handleBack}
              onMessageSent={handleMessageSent}
              onListRefresh={refresh}
              whatsappInstancia={whatsappInstancia}
            />
          ) : (
            <EmptyThread />
          )}
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
      initialMessages={initialMessages}
    />
  );
}

export { ConversationThreadExport as ConversationThread };
