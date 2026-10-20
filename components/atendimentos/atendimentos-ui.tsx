"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  Contact,
  FileText,
  Handshake,
  ImageIcon,
  MapPin,
  MessageSquare,
  Mic,
  Search,
  Tag,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  marcarConversaLida,
  marcarConversaNaoLida,
  setControleIA,
} from "@/lib/actions/conversas";
import { definirEtiquetaConversa } from "@/lib/actions/etiquetas";
import type { Database, Tables } from "@/types/database";
import { CASO_STATUS } from "@/lib/constants";
import {
  cleanMessageText,
  contactInitials,
  isClientMessage,
  parseContactPayload,
  parseLocationPayload,
  resolveMediaDisplayKind,
} from "@/lib/utils/messages";
import {
  formatChatDateSeparator,
  formatChatListTime,
  formatChatTime,
} from "@/lib/utils/dates";
import { formatPhone, phoneToContactNorm } from "@/lib/utils/phone";
import { ChatComposer } from "@/components/atendimentos/chat-composer";
import { ProcessoDaConversa } from "@/components/processos/vincular-processo";
import {
  EtiquetaChip,
  EtiquetaDot,
  GerenciarEtiquetasDialog,
  type Etiqueta,
} from "@/components/atendimentos/etiquetas";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toastErroAcao } from "@/lib/client/erros";

type Mensagem = Tables<"mensagens">;
export type ConversaRow =
  Database["public"]["Functions"]["listar_conversas"]["Returns"][number];

export type CasoMeta = {
  id: number;
  status: string | null;
  beneficio: string | null;
  cpf: string | null;
};

export type CasoMetaMap = Record<string, CasoMeta>;

/** Contato → nomes dos parceiros dos processos ligados a ele. */
export type ParceiroMetaMap = Record<string, string[]>;

function ParceiroChip({ nome }: { nome: string }) {
  return (
    <span
      className="inline-flex max-w-[160px] items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
      title={`Processo vinculado ao parceiro ${nome}`}
    >
      <Handshake className="size-3 shrink-0" />
      <span className="truncate">{nome}</span>
    </span>
  );
}

/** Modo geral da IA (página IA do WhatsApp) — define se o botão por conversa vale. */
export type IaInfo = {
  modo: "desligado" | "teste" | "publico";
  /** Já normalizados (mesma regra de contact_norm). */
  numerosTeste: string[];
};

type Conversation = {
  contact_norm: string;
  phone: string;
  displayName: string | null;
  fotoUrl: string | null;
  lastMessage: string;
  lastAt: string;
  lastFromUs: boolean;
  lastKind: "text" | "image" | "audio" | "video" | "document" | "location" | "contact";
  unread: number;
  marcadaNaoLida: boolean;
  lidaEm: string | null;
  iaPausada: boolean;
  etiquetas: number[];
  casoId: number | null;
  casoStatus: string | null;
  beneficio: string | null;
  cpf: string | null;
  pedeHumano: boolean;
  parceiros: string[];
};

type ContactNameMap = Record<string, string>;
type Filtro = "todas" | "nao_lidas" | "humano" | `etq:${number}`;

type EstadoIA = {
  chave: "desligada_geral" | "fora_do_teste" | "pausada" | "ligada";
  rotulo: string;
  dica: string;
};

function estadoIA(conv: Conversation, ia: IaInfo): EstadoIA {
  if (ia.modo === "desligado") {
    return {
      chave: "desligada_geral",
      rotulo: "IA desligada",
      dica: "A IA está desligada para todos os clientes. Para ligar, vá em IA do WhatsApp.",
    };
  }
  if (ia.modo === "teste" && !ia.numerosTeste.includes(conv.contact_norm)) {
    return {
      chave: "fora_do_teste",
      rotulo: "IA não responde (modo teste)",
      dica: "Em modo teste a IA só responde os números de teste. Este contato só é atendido pela equipe.",
    };
  }
  if (conv.iaPausada) {
    return {
      chave: "pausada",
      rotulo: "Humano atendendo · devolver para a IA",
      dica: "A equipe está atendendo e a IA não responde. Clique para a IA voltar a atender: ela responde quando o cliente mandar a próxima mensagem, já sabendo tudo o que foi conversado.",
    };
  }
  return {
    chave: "ligada",
    rotulo: "IA respondendo",
    dica: "A IA responde este contato. Clique para pausar e assumir a conversa.",
  };
}

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
  if (status === "atendimento_humano") return "Pede humano";
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

function previewKind(
  mensageType: string | null,
  media: string | null
): Conversation["lastKind"] {
  if (mensageType === "location") return "location";
  if (mensageType === "contact") return "contact";
  if (!media) return "text";
  const kind = resolveMediaDisplayKind(mensageType, media);
  if (kind === "audio" || kind === "video" || kind === "document") return kind;
  return "image";
}

const PREVIEW_LABEL: Record<Conversation["lastKind"], string> = {
  text: "",
  image: "Foto",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  location: "Localização",
  contact: "Contato",
};

function toConversation(
  row: ConversaRow,
  nameMap: ContactNameMap,
  casoMeta: CasoMetaMap,
  parceiroMeta: ParceiroMetaMap
): Conversation {
  const key = row.contact_norm;
  const caso = lookupCaso(casoMeta, key);
  const lastKind = previewKind(row.ultima_mensage_type, row.ultima_media);
  const texto =
    lastKind === "location" || lastKind === "contact"
      ? ""
      : cleanMessageText(row.ultima_texto);
  return {
    contact_norm: key,
    phone: row.phone ?? key,
    displayName:
      nameMap[key] ??
      nameMap[phoneToContactNorm(key)] ??
      (row.nome_whatsapp?.trim() || null),
    fotoUrl: row.foto_url,
    lastMessage: texto || PREVIEW_LABEL[lastKind],
    lastAt: row.ultima_em,
    lastFromUs: !isClientMessage(row.ultima_tipo),
    lastKind,
    unread: row.nao_lidas,
    marcadaNaoLida: row.marcada_nao_lida,
    lidaEm: row.lida_em,
    iaPausada: row.ia_pausada,
    etiquetas: row.etiquetas ?? [],
    casoId: caso?.id ?? null,
    casoStatus: caso?.status ?? null,
    beneficio: caso?.beneficio ?? null,
    cpf: caso?.cpf ?? null,
    pedeHumano: caso?.status === "atendimento_humano",
    parceiros:
      parceiroMeta[key] ?? parceiroMeta[phoneToContactNorm(key)] ?? [],
  };
}

function temNaoLida(c: Conversation) {
  return c.unread > 0 || c.marcadaNaoLida;
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

function ContactAvatar({
  phone,
  name,
  fotoUrl,
  className,
}: {
  phone: string;
  name: string | null;
  fotoUrl: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("shrink-0", className)}>
      {fotoUrl ? <AvatarImage src={fotoUrl} alt="" /> : null}
      <AvatarFallback className="bg-[#0b2148]/10 text-sm font-semibold text-[#0b2148]">
        {contactInitials(phone, name)}
      </AvatarFallback>
    </Avatar>
  );
}

function MediaPreview({
  msg,
  isClient,
  onMediaLoad,
}: {
  msg: Mensagem;
  isClient: boolean;
  onMediaLoad?: () => void;
}) {
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
        onLoad={onMediaLoad}
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
            onLoad={onMediaLoad}
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
          onLoadedMetadata={onMediaLoad}
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

function PreviewIcon({ kind }: { kind: Conversation["lastKind"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (kind) {
    case "image":
      return <ImageIcon className={cls} />;
    case "audio":
      return <Mic className={cls} />;
    case "video":
      return <Video className={cls} />;
    case "document":
      return <FileText className={cls} />;
    case "location":
      return <MapPin className={cls} />;
    case "contact":
      return <Contact className={cls} />;
    default:
      return null;
  }
}

/** Itens do menu de uma conversa (lista e cabeçalho), como o "⌄" do WhatsApp. */
function ConversaMenuItens({
  conv,
  etiquetas,
  fichaHref,
  onToggleNaoLida,
  onToggleEtiqueta,
  onGerenciarEtiquetas,
}: {
  conv: Conversation;
  etiquetas: Etiqueta[];
  fichaHref: string;
  onToggleNaoLida: (conv: Conversation) => void;
  onToggleEtiqueta: (conv: Conversation, etiquetaId: number, marcada: boolean) => void;
  onGerenciarEtiquetas: () => void;
}) {
  return (
    <>
      <DropdownMenuItem onClick={() => onToggleNaoLida(conv)}>
        {temNaoLida(conv) ? "Marcar como lida" : "Marcar como não lida"}
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Tag className="h-4 w-4" />
          Etiquetar conversa
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-52">
          {etiquetas.filter((e) => !e.chave).map((e) => (
            <DropdownMenuCheckboxItem
              key={e.id}
              checked={conv.etiquetas.includes(e.id)}
              onCheckedChange={(checked) => onToggleEtiqueta(conv, e.id, Boolean(checked))}
            >
              <EtiquetaDot cor={e.cor} />
              {e.nome}
            </DropdownMenuCheckboxItem>
          ))}
          {etiquetas.some((e) => !e.chave) ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onClick={onGerenciarEtiquetas}>
            Gerenciar etiquetas…
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem render={<Link href={fichaHref} />}>Ver ficha</DropdownMenuItem>
    </>
  );
}

function fichaHrefDe(conv: Conversation) {
  return conv.cpf
    ? `/clientes/${conv.cpf}`
    : `/clientes/contato/${encodeURIComponent(conv.contact_norm)}`;
}

function ConversationList({
  conversations,
  etiquetas,
  etiquetaById,
  selectedContact,
  search,
  onSearchChange,
  filtro,
  onFiltroChange,
  counts,
  onSelect,
  inboxEmpty,
  onToggleNaoLida,
  onToggleEtiqueta,
  onGerenciarEtiquetas,
}: {
  conversations: Conversation[];
  etiquetas: Etiqueta[];
  etiquetaById: Map<number, Etiqueta>;
  selectedContact: string | null;
  search: string;
  onSearchChange: (v: string) => void;
  filtro: Filtro;
  onFiltroChange: (f: Filtro) => void;
  counts: { naoLidas: number; humano: number; porEtiqueta: Record<number, number> };
  onSelect: (contact: string) => void;
  inboxEmpty?: boolean;
  onToggleNaoLida: (conv: Conversation) => void;
  onToggleEtiqueta: (conv: Conversation, etiquetaId: number, marcada: boolean) => void;
  onGerenciarEtiquetas: () => void;
}) {
  const [menuAberto, setMenuAberto] = useState<string | null>(null);

  const chips: { key: Filtro; label: string; count?: number; cor?: string }[] = [
    { key: "todas", label: "Todas" },
    { key: "nao_lidas", label: "Não lidas", count: counts.naoLidas },
    { key: "humano", label: "Pedem humano", count: counts.humano },
    ...etiquetas.map((e) => ({
      key: `etq:${e.id}` as Filtro,
      label: e.nome,
      count: counts.porEtiqueta[e.id] ?? 0,
      cor: e.cor,
    })),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-[#e2e8f0] bg-[#F8FAFC]">
      <div className="space-y-2.5 border-b border-[#e2e8f0] bg-white p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
          <Input
            placeholder="Pesquisar nome, número ou mensagem"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-10 border-[#e2e8f0] bg-[#F8FAFC] pl-9 text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12"
          />
        </div>
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none]">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onFiltroChange(chip.key)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
                filtro === chip.key
                  ? "border-[#0b2148] bg-[#0b2148] text-white"
                  : "border-[#e2e8f0] bg-white text-[#64748B] hover:border-[#0b2148]/30 hover:text-[#0b2148]"
              )}
            >
              {chip.cor ? <EtiquetaDot cor={chip.cor} /> : null}
              {chip.label}
              {chip.count ? (
                <span className={cn(filtro === chip.key ? "text-white/80" : "text-[#94a3b8]")}>
                  {chip.count}
                </span>
              ) : null}
            </button>
          ))}
          <button
            type="button"
            onClick={onGerenciarEtiquetas}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-[#cbd5e1] px-3 py-1 text-xs font-medium text-[#64748B] hover:border-[#0b2148]/40 hover:text-[#0b2148]"
          >
            <Tag className="h-3 w-3" />
            Etiquetas
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <MessageSquare className="mb-2 h-8 w-8 text-[#94a3b8]/60" />
            <p className="text-sm text-[#64748B]">
              {inboxEmpty
                ? "Nenhuma conversa"
                : search
                  ? "Nenhuma conversa encontrada"
                  : "Nenhuma conversa neste filtro"}
            </p>
            {inboxEmpty ? (
              <p className="mt-1 max-w-[240px] text-xs text-[#94a3b8]">
                As mensagens do WhatsApp aparecerão aqui.
              </p>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-[#eef2f6] bg-white">
            {conversations.map((c) => {
              const selected = selectedContact === c.contact_norm;
              const naoLida = temNaoLida(c);
              const statusText = c.pedeHumano ? "Pede humano" : null;
              const etqs = c.etiquetas
                .map((id) => etiquetaById.get(id))
                .filter((e): e is Etiqueta => Boolean(e));
              return (
                <li key={c.contact_norm}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(c.contact_norm)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(c.contact_norm);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenuAberto(c.contact_norm);
                    }}
                    className={cn(
                      "group relative flex cursor-pointer gap-3 px-3 py-2.5 outline-none transition focus-visible:bg-[#F1F5F9]",
                      selected ? "bg-[#0b2148]/[0.07]" : "hover:bg-[#F8FAFC]"
                    )}
                  >
                    <ContactAvatar
                      phone={c.phone}
                      name={c.displayName}
                      fotoUrl={c.fotoUrl}
                      className="h-12 w-12"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate font-semibold text-[#0b2148]">
                          {c.displayName ?? formatPhone(c.phone)}
                        </p>
                        <span
                          className={cn(
                            "shrink-0 text-[11px]",
                            naoLida ? "font-semibold text-emerald-600" : "text-[#94a3b8]"
                          )}
                        >
                          {formatChatListTime(c.lastAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <p
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-1 text-sm",
                            naoLida ? "font-medium text-[#334155]" : "text-[#64748B]"
                          )}
                        >
                          {c.lastFromUs ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
                          ) : null}
                          <PreviewIcon kind={c.lastKind} />
                          <span className="truncate">{c.lastMessage || "—"}</span>
                        </p>
                        {c.unread > 0 ? (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-white">
                            {c.unread > 99 ? "99+" : c.unread}
                          </span>
                        ) : c.marcadaNaoLida ? (
                          <span
                            className="size-3 shrink-0 rounded-full bg-emerald-500"
                            aria-label="Marcada como não lida"
                          />
                        ) : null}
                        <DropdownMenu
                          open={menuAberto === c.contact_norm}
                          onOpenChange={(open) => setMenuAberto(open ? c.contact_norm : null)}
                        >
                          <DropdownMenuTrigger
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Opções da conversa"
                            className={cn(
                              "-mr-1 shrink-0 rounded p-0.5 text-[#94a3b8] hover:bg-[#e2e8f0] hover:text-[#0b2148]",
                              menuAberto === c.contact_norm
                                ? "opacity-100"
                                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                            )}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="min-w-52"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ConversaMenuItens
                              conv={c}
                              etiquetas={etiquetas}
                              fichaHref={fichaHrefDe(c)}
                              onToggleNaoLida={onToggleNaoLida}
                              onToggleEtiqueta={onToggleEtiqueta}
                              onGerenciarEtiquetas={onGerenciarEtiquetas}
                            />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {statusText || etqs.length > 0 || c.parceiros.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {c.parceiros.map((nome) => (
                            <ParceiroChip key={nome} nome={nome} />
                          ))}
                          {statusText ? (
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                statusPillClasses(c.casoStatus)
                              )}
                            >
                              {statusText}
                            </span>
                          ) : null}
                          {etqs.slice(0, 3).map((e) => (
                            <EtiquetaChip key={e.id} etiqueta={e} />
                          ))}
                          {etqs.length > 3 ? (
                            <span className="text-[11px] text-[#94a3b8]">
                              +{etqs.length - 3}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

const PERTO_DO_FIM_PX = 80;

function ConversationThread({
  conv,
  ia,
  etiquetas,
  etiquetaById,
  lidaAoAbrir,
  onBack,
  onListRefresh,
  whatsappInstancia,
  onIaPausadaChange,
  onToggleNaoLida,
  onToggleEtiqueta,
  onGerenciarEtiquetas,
}: {
  conv: Conversation;
  ia: IaInfo;
  etiquetas: Etiqueta[];
  etiquetaById: Map<number, Etiqueta>;
  /** lida_em no momento em que a conversa foi aberta (para a faixa "não lidas"). */
  lidaAoAbrir: string | null | undefined;
  onBack: () => void;
  onListRefresh: () => void;
  whatsappInstancia?: string;
  onIaPausadaChange: (pausada: boolean) => void;
  onToggleNaoLida: (conv: Conversation) => void;
  onToggleEtiqueta: (conv: Conversation, etiquetaId: number, marcada: boolean) => void;
  onGerenciarEtiquetas: () => void;
}) {
  const contactNorm = conv.contact_norm;
  const [messages, setMessages] = useState<Mensagem[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentBusy, setAgentBusy] = useState(false);
  const [novas, setNovas] = useState(0);
  const [longeDoFim, setLongeDoFim] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const naoLidasRef = useRef<HTMLDivElement>(null);
  const grudadoNoFim = useRef(true);
  const qtdAnterior = useRef(0);

  const refresh = useCallback(() => {
    return createClient()
      .from("mensagens")
      .select("*")
      .eq("contact_norm", contactNorm)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) setMessages(data);
        setLoading(false);
      });
  }, [contactNorm]);

  useEffect(() => {
    void refresh();
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
        () => void refresh()
      )
      .subscribe();
    const interval = setInterval(() => void refresh(), 45000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [contactNorm, refresh]);

  const irParaOFim = useCallback((suave = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: suave ? "smooth" : "auto" });
    grudadoNoFim.current = true;
    setNovas(0);
    setLongeDoFim(false);
  }, []);

  // Como no WhatsApp: abre no fim (ou na faixa de não lidas) e acompanha as
  // mensagens novas enquanto você está no fim; se rolou para cima, mostra o botão.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    const adicionadas = messages.length - qtdAnterior.current;
    if (qtdAnterior.current === 0) {
      const faixa = naoLidasRef.current;
      if (faixa && faixa.offsetTop > el.clientHeight) {
        el.scrollTop = faixa.offsetTop - 12;
        grudadoNoFim.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < PERTO_DO_FIM_PX;
        setLongeDoFim(!grudadoNoFim.current);
      } else {
        el.scrollTop = el.scrollHeight;
      }
    } else if (adicionadas > 0) {
      if (grudadoNoFim.current) el.scrollTop = el.scrollHeight;
      else setNovas((n) => n + adicionadas);
    }
    qtdAnterior.current = messages.length;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const perto = el.scrollHeight - el.scrollTop - el.clientHeight < PERTO_DO_FIM_PX;
    grudadoNoFim.current = perto;
    setLongeDoFim(!perto);
    if (perto && novas) setNovas(0);
  };

  // Foto/vídeo que termina de carregar aumenta a altura: mantém no fim.
  const onMediaLoad = useCallback(() => {
    const el = scrollRef.current;
    if (el && grudadoNoFim.current) el.scrollTop = el.scrollHeight;
  }, []);

  const groups = useMemo(() => groupMessagesByDate(messages), [messages]);

  const primeiraNaoLidaId = useMemo(() => {
    if (lidaAoAbrir === undefined) return null;
    // Mesma regra do banco: resposta da equipe (não da IA) também conta como leitura.
    const ultimaDaEquipe = messages.reduce(
      (max, m) =>
        !isClientMessage(m.type) && m.session_id !== "ia"
          ? Math.max(max, new Date(m.created_at).getTime())
          : max,
      -Infinity
    );
    const limite = Math.max(
      lidaAoAbrir ? new Date(lidaAoAbrir).getTime() : -Infinity,
      ultimaDaEquipe
    );
    return (
      messages.find(
        (m) => isClientMessage(m.type) && new Date(m.created_at).getTime() > limite
      )?.id ?? null
    );
  }, [messages, lidaAoAbrir]);
  const qtdNaoLidasAoAbrir = useMemo(() => {
    if (primeiraNaoLidaId == null) return 0;
    const idx = messages.findIndex((m) => m.id === primeiraNaoLidaId);
    return messages.slice(idx).filter((m) => isClientMessage(m.type)).length;
  }, [messages, primeiraNaoLidaId]);

  const handleComposerSent = useCallback(
    (msg: Mensagem, iaPausada?: boolean) => {
      setMessages((prev) => mergeMessageAsc(prev, msg));
      grudadoNoFim.current = true;
      requestAnimationFrame(() => irParaOFim(true));
      onListRefresh();
      if (iaPausada) onIaPausadaChange(true);
    },
    [irParaOFim, onIaPausadaChange, onListRefresh]
  );

  const estado = estadoIA(conv, ia);

  const toggleAgent = async () => {
    if (agentBusy) return;
    if (estado.chave !== "ligada" && estado.chave !== "pausada") return;
    setAgentBusy(true);
    const pausar = estado.chave === "ligada";
    try {
      await setControleIA({
        acao: pausar ? "pausar" : "despausar",
        telefone: conv.phone,
        instancia: whatsappInstancia,
      });
      onIaPausadaChange(pausar);
      toast.success(
        pausar
          ? "IA pausada nesta conversa. A equipe assume daqui."
          : "Devolvido para a IA. Ela responde quando o cliente mandar a próxima mensagem."
      );
    } catch (err) {
      toastErroAcao(err, "Falha ao controlar a IA");
    } finally {
      setAgentBusy(false);
    }
  };

  const fichaHref = fichaHrefDe(conv);
  const statusText = shortStatusLabel(conv.casoStatus);
  const benefitLabel = conv.beneficio?.trim() || "Benefício não identificado";
  const etqs = conv.etiquetas
    .map((id) => etiquetaById.get(id))
    .filter((e): e is Etiqueta => Boolean(e));

  const iaClasses: Record<EstadoIA["chave"], string> = {
    ligada: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    pausada: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
    fora_do_teste: "border-[#e2e8f0] bg-white text-[#64748B] hover:border-[#0b2148]/30",
    desligada_geral: "border-[#e2e8f0] bg-white text-[#64748B] hover:border-[#0b2148]/30",
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F1F5F9]">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#e2e8f0] bg-white px-4 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg p-1.5 text-[#0b2148] hover:bg-[#F1F5F9] lg:hidden"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex min-w-[220px] flex-1 items-center gap-3">
          <ContactAvatar
            phone={conv.phone}
            name={conv.displayName}
            fotoUrl={conv.fotoUrl}
            className="h-10 w-10"
          />
          <div className="min-w-0">
            <p className="truncate font-semibold text-[#0b2148]">
              {conv.displayName ?? formatPhone(conv.phone)}
            </p>
            <p className="truncate text-xs text-[#64748B]">
              {formatPhone(conv.phone)}
              <span className="mx-1.5 text-[#cbd5e1]">·</span>
              {benefitLabel}
            </p>
            {etqs.length > 0 || conv.parceiros.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {conv.parceiros.map((nome) => (
                  <ParceiroChip key={nome} nome={nome} />
                ))}
                {etqs.map((e) => (
                  <EtiquetaChip key={e.id} etiqueta={e} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {statusText ? (
            <span
              className={cn(
                "hidden rounded-full border px-2.5 py-1 text-xs font-medium xl:inline-flex",
                statusPillClasses(conv.casoStatus)
              )}
            >
              {statusText}
            </span>
          ) : null}
          {estado.chave === "ligada" || estado.chave === "pausada" ? (
            <button
              type="button"
              disabled={agentBusy}
              onClick={() => void toggleAgent()}
              title={estado.dica}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition disabled:opacity-60",
                iaClasses[estado.chave]
              )}
            >
              <Bot className="h-3.5 w-3.5" />
              {estado.rotulo}
            </button>
          ) : (
            <Link
              href="/ia-whatsapp"
              title={estado.dica}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition",
                iaClasses[estado.chave]
              )}
            >
              <Bot className="h-3.5 w-3.5" />
              {estado.rotulo}
            </Link>
          )}
          <ProcessoDaConversa
            contactNorm={conv.contact_norm}
            cpf={conv.cpf}
            casoId={conv.casoId}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Etiquetas e opções"
                  className="h-8 rounded-full border-[#e2e8f0] px-2.5 text-[#0b2148]"
                />
              }
            >
              <Tag className="h-3.5 w-3.5" />
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Etiquetas</DropdownMenuLabel>
                {etiquetas.filter((e) => !e.chave).map((e) => (
                  <DropdownMenuCheckboxItem
                    key={e.id}
                    checked={conv.etiquetas.includes(e.id)}
                    onCheckedChange={(checked) =>
                      onToggleEtiqueta(conv, e.id, Boolean(checked))
                    }
                  >
                    <EtiquetaDot cor={e.cor} />
                    {e.nome}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuItem onClick={onGerenciarEtiquetas}>
                  Gerenciar etiquetas…
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onToggleNaoLida(conv)}>
                {temNaoLida(conv) ? "Marcar como lida" : "Marcar como não lida"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto"
        >
          <div className="space-y-4 p-4">
            {loading && messages.length === 0 ? (
              <p className="py-10 text-center text-sm text-[#94a3b8]">
                Carregando mensagens…
              </p>
            ) : null}
            {groups.map((group) => (
              <div key={group.dateLabel}>
                <div className="sticky top-0 z-10 mb-3 flex justify-center">
                  <span className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs text-[#64748B] shadow-sm">
                    {group.dateLabel}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.messages.map((msg) => {
                    const isClient = isClientMessage(msg.type);
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
                      <div key={msg.id}>
                        {msg.id === primeiraNaoLidaId ? (
                          <div ref={naoLidasRef} className="my-3 flex justify-center">
                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                              {qtdNaoLidasAoAbrir === 1
                                ? "1 mensagem não lida"
                                : `${qtdNaoLidasAoAbrir} mensagens não lidas`}
                            </span>
                          </div>
                        ) : null}
                        <div
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
                            {msg.session_id === "ia" ? (
                              <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#0b2148]/60">
                                <Bot className="h-3 w-3" />
                                IA
                              </p>
                            ) : null}
                            <MediaPreview
                              msg={msg}
                              isClient={isClient}
                              onMediaLoad={onMediaLoad}
                            />
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
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        {novas > 0 || longeDoFim ? (
          <button
            type="button"
            onClick={() => irParaOFim(true)}
            aria-label="Ir para a última mensagem"
            className="absolute bottom-3 right-4 flex h-10 items-center gap-1.5 rounded-full border border-[#e2e8f0] bg-white px-3 text-[#0b2148] shadow-md transition hover:bg-[#F8FAFC]"
          >
            {novas > 0 ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-white">
                {novas}
              </span>
            ) : null}
            <ArrowDown className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="shrink-0">
        <ChatComposer
          phone={conv.phone}
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

function normalizarBusca(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function AtendimentosPanel({
  initialConversas,
  initialEtiquetas,
  initialContact,
  contactNames = {},
  whatsappInstancia,
  casoMeta = {},
  parceiroMeta = {},
  ia,
}: {
  initialConversas: ConversaRow[];
  initialEtiquetas: Etiqueta[];
  initialContact?: string | null;
  contactNames?: ContactNameMap;
  whatsappInstancia?: string;
  casoMeta?: CasoMetaMap;
  parceiroMeta?: ParceiroMetaMap;
  ia: IaInfo;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialConversas);
  const [etiquetas, setEtiquetas] = useState(initialEtiquetas);
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [selectedContact, setSelectedContact] = useState<string | null>(
    initialContact ?? null
  );
  const [mobileShowThread, setMobileShowThread] = useState(!!initialContact);
  const [gerenciarAberto, setGerenciarAberto] = useState(false);
  /** lida_em de cada conversa no momento em que foi aberta (faixa "não lidas"). */
  const [lidaAoAbrir, setLidaAoAbrir] = useState<Record<string, string | null>>(() => {
    const inicial = initialConversas.find((r) => r.contact_norm === initialContact);
    return inicial && (inicial.nao_lidas > 0 || inicial.marcada_nao_lida)
      ? { [inicial.contact_norm]: inicial.lida_em }
      : {};
  });

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc("listar_conversas", { p_limite: 1000 });
    if (data) setRows(data);
  }, []);

  const refreshEtiquetas = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("app_etiquetas")
      .select("*")
      .order("ordem")
      .order("id");
    if (data) setEtiquetas(data);
  }, []);

  // Tempo real: mensagens, pausa da IA, foto e etiquetas. Agrupa rajadas.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const agendar = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 400);
    };
    const supabase = createClient();
    const channel = supabase
      .channel("atendimentos-lista")
      .on("postgres_changes", { event: "*", schema: "public", table: "mensagens" }, agendar)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_ia_estado" }, agendar)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_conversa_etiquetas" },
        agendar
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "app_etiquetas" }, () => {
        void refreshEtiquetas();
        agendar();
      })
      .subscribe();
    const interval = setInterval(() => void refresh(), 60000);
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [refresh, refreshEtiquetas]);

  // Voltar para a aba com a conversa aberta também conta como leitura.
  const [abaVisivel, setAbaVisivel] = useState(true);
  useEffect(() => {
    const onVisible = () => setAbaVisivel(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // A conversa aberta (com a aba visível) é sempre lida, como no WhatsApp.
  const conversations = useMemo(
    () =>
      rows.map((r) => {
        const c = toConversation(r, contactNames, casoMeta, parceiroMeta);
        return c.contact_norm === selectedContact && abaVisivel
          ? { ...c, unread: 0, marcadaNaoLida: false }
          : c;
      }),
    [rows, contactNames, casoMeta, parceiroMeta, selectedContact, abaVisivel]
  );

  const etiquetaById = useMemo(
    () => new Map(etiquetas.map((e) => [e.id, e])),
    [etiquetas]
  );

  const selectedConv = conversations.find((c) => c.contact_norm === selectedContact);

  // Grava a leitura no banco ao abrir e a cada mensagem nova com ela aberta.
  const selectedRow = rows.find((r) => r.contact_norm === selectedContact);
  const selectedPendente = Boolean(
    selectedRow && (selectedRow.nao_lidas > 0 || selectedRow.marcada_nao_lida)
  );
  const selectedUltimaEm = selectedRow?.ultima_em;
  useEffect(() => {
    if (!selectedContact || !selectedPendente || !abaVisivel) return;
    marcarConversaLida(selectedContact)
      .then(() => refresh())
      .catch(() => {});
  }, [selectedContact, selectedPendente, selectedUltimaEm, abaVisivel, refresh]);

  const counts = useMemo(() => {
    const porEtiqueta: Record<number, number> = {};
    for (const c of conversations) {
      for (const id of c.etiquetas) porEtiqueta[id] = (porEtiqueta[id] ?? 0) + 1;
    }
    return {
      naoLidas: conversations.filter(temNaoLida).length,
      humano: conversations.filter((c) => c.pedeHumano).length,
      porEtiqueta,
    };
  }, [conversations]);

  // Filtro "Não lidas": a conversa aberta continua na lista mesmo depois de lida.
  const visibleConversations = useMemo(() => {
    let list = conversations;
    if (filtro === "nao_lidas") {
      list = list.filter((c) => temNaoLida(c) || c.contact_norm === selectedContact);
    } else if (filtro === "humano") {
      list = list.filter((c) => c.pedeHumano);
    } else if (filtro.startsWith("etq:")) {
      const id = Number(filtro.slice(4));
      list = list.filter((c) => c.etiquetas.includes(id));
    }
    const q = normalizarBusca(search.trim());
    if (!q) return list;
    const digitos = q.replace(/\D/g, "");
    return list.filter((c) => {
      const nomesEtiquetas = c.etiquetas
        .map((id) => etiquetaById.get(id)?.nome ?? "")
        .join(" ");
      return (
        (digitos.length >= 3 && c.phone.replace(/\D/g, "").includes(digitos)) ||
        normalizarBusca(c.displayName ?? "").includes(q) ||
        normalizarBusca(c.lastMessage).includes(q) ||
        normalizarBusca(nomesEtiquetas).includes(q)
      );
    });
  }, [conversations, filtro, search, selectedContact, etiquetaById]);

  const handleSelect = (contact: string) => {
    const conv = conversations.find((c) => c.contact_norm === contact);
    setLidaAoAbrir((prev) => {
      const next = { ...prev };
      if (conv && temNaoLida(conv)) next[contact] = conv.lidaEm;
      else delete next[contact];
      return next;
    });
    setSelectedContact(contact);
    setMobileShowThread(true);
    router.replace(`/atendimentos?contact=${encodeURIComponent(contact)}`, {
      scroll: false,
    });
  };

  const handleBack = useCallback(() => {
    setMobileShowThread(false);
    setSelectedContact(null);
    router.replace("/atendimentos", { scroll: false });
  }, [router]);

  // Esc fecha a conversa, como no WhatsApp Web (se nenhum menu/janela estiver aberto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !selectedContact) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      handleBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedContact, handleBack]);

  const atualizarRow = useCallback(
    (contact: string, patch: Partial<ConversaRow>) => {
      setRows((prev) =>
        prev.map((r) => (r.contact_norm === contact ? { ...r, ...patch } : r))
      );
    },
    []
  );

  const handleToggleNaoLida = useCallback(
    async (conv: Conversation) => {
      try {
        if (temNaoLida(conv)) {
          atualizarRow(conv.contact_norm, {
            nao_lidas: 0,
            marcada_nao_lida: false,
            lida_em: new Date().toISOString(),
          });
          await marcarConversaLida(conv.contact_norm);
        } else {
          atualizarRow(conv.contact_norm, { marcada_nao_lida: true });
          // Marcar a aberta como não lida fecha a conversa (senão ela já "leria" de novo).
          if (conv.contact_norm === selectedContact) handleBack();
          await marcarConversaNaoLida(conv.contact_norm);
        }
      } catch (err) {
        toastErroAcao(err, "Não foi possível atualizar a conversa");
        void refresh();
      }
    },
    [atualizarRow, handleBack, refresh, selectedContact]
  );

  const handleToggleEtiqueta = useCallback(
    async (conv: Conversation, etiquetaId: number, marcada: boolean) => {
      const atuais = conv.etiquetas.filter((id) => id !== etiquetaId);
      atualizarRow(conv.contact_norm, {
        etiquetas: marcada ? [...atuais, etiquetaId] : atuais,
      });
      try {
        await definirEtiquetaConversa({
          contactNorm: conv.contact_norm,
          etiquetaId,
          marcada,
        });
      } catch (err) {
        toastErroAcao(err, "Não foi possível etiquetar a conversa");
        void refresh();
      }
    },
    [atualizarRow, refresh]
  );

  const inboxEmpty = conversations.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-[#0b2148]">
          Atendimentos
        </h1>
        <p className="text-sm text-[#64748B]">
          Conversas do WhatsApp do escritório, atendidas pela equipe e pela IA
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
        <div className="grid min-h-0 flex-1 lg:grid-cols-[360px_1fr]">
          <div
            className={cn(
              "h-full min-h-0",
              mobileShowThread ? "hidden lg:block" : "block"
            )}
          >
            <ConversationList
              conversations={visibleConversations}
              etiquetas={etiquetas}
              etiquetaById={etiquetaById}
              selectedContact={selectedContact}
              search={search}
              onSearchChange={setSearch}
              filtro={filtro}
              onFiltroChange={setFiltro}
              counts={counts}
              onSelect={handleSelect}
              inboxEmpty={inboxEmpty}
              onToggleNaoLida={(c) => void handleToggleNaoLida(c)}
              onToggleEtiqueta={(c, id, m) => void handleToggleEtiqueta(c, id, m)}
              onGerenciarEtiquetas={() => setGerenciarAberto(true)}
            />
          </div>

          <div
            className={cn(
              "h-full min-h-0",
              mobileShowThread ? "block" : "hidden lg:block"
            )}
          >
            {selectedConv ? (
              <ConversationThread
                key={selectedConv.contact_norm}
                conv={selectedConv}
                ia={ia}
                etiquetas={etiquetas}
                etiquetaById={etiquetaById}
                lidaAoAbrir={
                  selectedConv.contact_norm in lidaAoAbrir
                    ? lidaAoAbrir[selectedConv.contact_norm]
                    : undefined
                }
                onBack={handleBack}
                onListRefresh={() => void refresh()}
                whatsappInstancia={whatsappInstancia}
                onIaPausadaChange={(pausada) =>
                  atualizarRow(selectedConv.contact_norm, { ia_pausada: pausada })
                }
                onToggleNaoLida={(c) => void handleToggleNaoLida(c)}
                onToggleEtiqueta={(c, id, m) => void handleToggleEtiqueta(c, id, m)}
                onGerenciarEtiquetas={() => setGerenciarAberto(true)}
              />
            ) : (
              <EmptyThread inboxEmpty={inboxEmpty} />
            )}
          </div>
        </div>
      </div>

      <GerenciarEtiquetasDialog
        open={gerenciarAberto}
        onOpenChange={setGerenciarAberto}
        etiquetas={etiquetas}
        usos={counts.porEtiqueta}
        onAlteradas={() => {
          void refreshEtiquetas();
          void refresh();
        }}
      />
    </div>
  );
}
