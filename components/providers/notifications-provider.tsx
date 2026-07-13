"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { CASO_STATUS } from "@/lib/constants";
import { formatPhone } from "@/lib/utils/phone";

export type PainelNotificacao = {
  id: string;
  kind: "mensagem" | "kanban" | "transferencia" | "documento" | "aprovacao";
  title: string;
  body: string;
  href: string;
  at: number;
  read: boolean;
};

type NotificationsContextValue = {
  notifications: PainelNotificacao[];
  unreadCount: number;
  markAllRead: () => void;
  clearAll: () => void;
  openNotification: (n: PainelNotificacao) => void;
  muted: boolean;
  setMuted: (v: boolean) => void;
  browserPermission: NotificationPermission | "unsupported";
  requestBrowserPermission: () => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications fora do NotificationsProvider");
  return ctx;
}

function statusLabel(status: string | null | undefined) {
  return CASO_STATUS.find((s) => s.value === status)?.label ?? status ?? "—";
}

/** Blip curto e discreto via WebAudio — sem arquivo de áudio. */
function playBlip() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0.035;

    const tone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    tone(880, 0, 0.07);
    tone(1174, 0.09, 0.09);
    setTimeout(() => ctx.close(), 400);
  } catch {
    // áudio bloqueado pelo navegador — silencioso
  }
}

let seq = 0;
function nid() {
  return `${Date.now()}-${seq++}`;
}

export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [notifications, setNotifications] = useState<PainelNotificacao[]>([]);
  const [muted, setMutedState] = useState(false);
  const [browserPermission, setBrowserPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");

  // refs para não recriar o canal realtime a cada navegação
  const routeRef = useRef({ pathname, contact: searchParams.get("contact") });
  useEffect(() => {
    routeRef.current = { pathname, contact: searchParams.get("contact") };
  }, [pathname, searchParams]);

  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    setMutedState(localStorage.getItem("painel-notif-mudo") === "1");
    if ("Notification" in window) {
      setBrowserPermission(Notification.permission);
    }
  }, []);

  const setMuted = useCallback((v: boolean) => {
    setMutedState(v);
    localStorage.setItem("painel-notif-mudo", v ? "1" : "0");
  }, []);

  const requestBrowserPermission = useCallback(() => {
    if (!("Notification" in window)) return;
    Notification.requestPermission().then(setBrowserPermission);
  }, []);

  const push = useCallback(
    (
      n: Omit<PainelNotificacao, "id" | "at" | "read">,
      opts: { sound?: boolean; toast?: boolean } = { sound: true, toast: true }
    ) => {
      const item: PainelNotificacao = { ...n, id: nid(), at: Date.now(), read: false };
      setNotifications((prev) => [item, ...prev].slice(0, 50));

      if (opts.toast !== false) {
        toast(n.title, {
          description: n.body,
          action: { label: "Abrir", onClick: () => router.push(n.href) },
        });
      }
      if (opts.sound !== false && !mutedRef.current) playBlip();

      if (
        "Notification" in window &&
        Notification.permission === "granted" &&
        document.hidden
      ) {
        try {
          const bn = new Notification(n.title, { body: n.body, tag: item.id });
          bn.onclick = () => {
            window.focus();
            router.push(n.href);
          };
        } catch {
          // alguns navegadores exigem service worker — ignora
        }
      }
    },
    [router]
  );

  // Com RLS ligado o Realtime NÃO envia os valores antigos no UPDATE (só a PK),
  // então guardamos o último status de cada caso aqui para detectar a mudança de coluna.
  const statusCacheRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    const supabase = createClient();

    // popula o cache inicial de status dos casos
    supabase
      .from("casos_novos")
      .select("id, status")
      .then(({ data }) => {
        for (const c of data ?? []) {
          statusCacheRef.current.set(c.id, c.status ?? "em_atendimento");
        }
      });

    const channel = supabase
      .channel("painel-notificacoes")
      // 1) Lead mandou mensagem
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mensagens" },
        (payload) => {
          const msg = payload.new as {
            type: string | null;
            text: string | null;
            contact_norm: string | null;
            phone: string | null;
            conteudo_media: string | null;
          };
          if (msg.type === "bot") return; // resposta nossa/da IA
          const contact = msg.contact_norm ?? "";
          const { pathname: path, contact: openContact } = routeRef.current;
          // conversa já aberta na tela → sem notificação
          if (path.startsWith("/atendimentos") && openContact === contact) return;

          const bruto = msg.text?.replace(/^\[MENSAGEM DE TEXTO ENVIADA\]:\s*/i, "") ?? "";
          const semParenteses =
            bruto.startsWith("(") && bruto.endsWith(")")
              ? bruto.slice(1, -1)
              : bruto;
          const texto = semParenteses || (msg.conteudo_media ? "[mídia]" : "");
          push({
            kind: "mensagem",
            title: `💬 ${formatPhone(msg.phone ?? contact)}`,
            body: texto.slice(0, 120),
            href: `/atendimentos?contact=${encodeURIComponent(contact)}`,
          });
        }
      )
      // 2) Caso novo entrou no funil
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "casos_novos" },
        (payload) => {
          const novo = payload.new as {
            id: number;
            nome: string | null;
            telefone: string | null;
            status: string | null;
          };
          statusCacheRef.current.set(novo.id, novo.status ?? "em_atendimento");
          push(
            {
              kind: "kanban",
              title: "🆕 Novo lead no funil",
              body: `${novo.nome ?? formatPhone(novo.telefone ?? "")} entrou em ${statusLabel(
                novo.status ?? "em_atendimento"
              )}`,
              href: `/kanban/${novo.id}`,
            },
            { sound: false, toast: true }
          );
        }
      )
      // 3) Caso mudou de coluna / transferido para advogado
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "casos_novos" },
        (payload) => {
          const novo = payload.new as {
            id: number;
            nome: string | null;
            telefone: string | null;
            status: string | null;
          };
          const statusNovo = novo.status ?? "em_atendimento";
          // RLS impede o realtime de mandar o valor antigo — usamos o cache local
          const antigoRealtime = (payload.old as { status?: string | null })?.status;
          const statusAntigo =
            antigoRealtime ?? statusCacheRef.current.get(novo.id) ?? null;
          statusCacheRef.current.set(novo.id, statusNovo);

          if (!statusAntigo || statusAntigo === statusNovo) return; // update sem troca de coluna

          const quem = novo.nome ?? formatPhone(novo.telefone ?? "");
          if (statusNovo === "atendimento_humano") {
            push({
              kind: "transferencia",
              title: "🙋 Cliente pediu atendimento humano",
              body: `${quem} está aguardando o advogado`,
              href: `/atendimentos?contact=${encodeURIComponent(
                (novo.telefone ?? "").replace(/\D/g, "")
              )}`,
            });
          } else {
            push(
              {
                kind: "kanban",
                title: "📋 Caso movido no funil",
                body: `${quem}: ${statusLabel(statusAntigo)} → ${statusLabel(statusNovo)}`,
                href: `/kanban/${novo.id}`,
              },
              { sound: false, toast: true }
            );
          }
        }
      )
      // 4) Documento novo recebido do cliente
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "documentos_cliente" },
        (payload) => {
          const doc = payload.new as {
            caso_id: number;
            nome_documento: string;
            origem: string;
          };
          if (doc.origem === "advogado") return; // upload nosso
          push({
            kind: "documento",
            title: "📎 Documento recebido",
            body: doc.nome_documento,
            href: `/kanban/${doc.caso_id}`,
          });
        }
      )
      // 5) Nova pendência de aprovação
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "aprovacoes_pendentes" },
        (payload) => {
          const ap = payload.new as {
            id: number;
            nome_cliente: string | null;
            telefone_cliente: string;
          };
          push({
            kind: "aprovacao",
            title: "✅ Nova aprovação pendente",
            body: `${ap.nome_cliente ?? formatPhone(ap.telefone_cliente)} aguardando sua revisão`,
            href: `/aprovacoes/${ap.id}`,
          });
        }
      )
      .subscribe((status, err) => {
        if (status !== "SUBSCRIBED") {
          console.warn("[notificações] canal realtime:", status, err?.message ?? "");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [push]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = useCallback(
    () => setNotifications((prev) => prev.map((n) => ({ ...n, read: true }))),
    []
  );
  const clearAll = useCallback(() => setNotifications([]), []);
  const openNotification = useCallback(
    (n: PainelNotificacao) => {
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))
      );
      router.push(n.href);
    },
    [router]
  );

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        markAllRead,
        clearAll,
        openNotification,
        muted,
        setMuted,
        browserPermission,
        requestBrowserPermission,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}
