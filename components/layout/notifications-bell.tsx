"use client";

import { useState } from "react";
import {
  Bell,
  BellOff,
  CheckCheck,
  FileText,
  Kanban,
  MessageSquare,
  Trash2,
  UserRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useNotifications,
  type PainelNotificacao,
} from "@/components/providers/notifications-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { formatRelative } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<PainelNotificacao["kind"], typeof Bell> = {
  mensagem: MessageSquare,
  kanban: Kanban,
  transferencia: UserRound,
  documento: FileText,
  aprovacao: CheckCheck,
};

export function NotificationsBell() {
  const {
    notifications,
    unreadCount,
    markAllRead,
    clearAll,
    openNotification,
    muted,
    setMuted,
    browserPermission,
    requestBrowserPermission,
  } = useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background hover:bg-muted"
        aria-label="Notificações"
      >
        {unreadCount > 0 ? (
          <Bell className="h-4 w-4" />
        ) : (
          <BellOff className="h-4 w-4 text-muted-foreground" />
        )}
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <p className="text-sm font-semibold">Notificações</p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setMuted(!muted)}
              aria-label={muted ? "Ativar som" : "Silenciar"}
              title={muted ? "Som desligado" : "Som ligado"}
            >
              {muted ? (
                <VolumeX className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={markAllRead}
              aria-label="Marcar todas como lidas"
              title="Marcar todas como lidas"
            >
              <CheckCheck className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={clearAll}
              aria-label="Limpar"
              title="Limpar"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Separator />
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Sem notificações por enquanto. Mensagens de clientes, movimentações
              do funil, documentos e aprovações aparecem aqui.
            </p>
          ) : (
            <ul>
              {notifications.map((n) => {
                const Icon = KIND_ICON[n.kind];
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        openNotification(n);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-start gap-3 border-b px-3 py-2.5 text-left hover:bg-muted/50",
                        !n.read && "bg-primary/5"
                      )}
                    >
                      <Icon
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0",
                          n.read ? "text-muted-foreground" : "text-primary"
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-sm",
                            !n.read && "font-semibold"
                          )}
                        >
                          {n.title}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {n.body}
                        </span>
                        <span className="block text-[10px] text-muted-foreground/70">
                          {formatRelative(new Date(n.at).toISOString())}
                        </span>
                      </span>
                      {!n.read && (
                        <Badge className="h-2 w-2 shrink-0 rounded-full p-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {browserPermission === "default" && (
          <>
            <Separator />
            <div className="p-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={requestBrowserPermission}
              >
                Ativar notificações do navegador (com o painel em 2º plano)
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
