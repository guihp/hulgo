"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Kanban,
  CheckCircle,
  Users,
  MessageSquare,
  FileBarChart,
  FolderOpen,
  CalendarClock,
  Menu,
  LogOut,
  Settings,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { GlobalSearch } from "@/components/layout/global-search";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { NotificationsProvider } from "@/components/providers/notifications-provider";
import { APP_NAME } from "@/lib/constants";
import type { AppUser } from "@/lib/actions/auth";
import { signOut } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

const icons = {
  LayoutDashboard,
  Kanban,
  CheckCircle,
  Users,
  MessageSquare,
  FileBarChart,
  FolderOpen,
  CalendarClock,
  Settings,
} as const;

const navItems = [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard" as const },
  { href: "/kanban", label: "Funil de atendimento", icon: "Kanban" as const },
  { href: "/aprovacoes", label: "Aprovações", icon: "CheckCircle" as const, badge: "aprovacoes" as const },
  { href: "/prazos", label: "Prazos", icon: "CalendarClock" as const, badge: "prazos" as const },
  { href: "/clientes", label: "Clientes", icon: "Users" as const },
  { href: "/atendimentos", label: "Atendimentos", icon: "MessageSquare" as const },
  { href: "/arquivos", label: "Arquivos", icon: "FolderOpen" as const },
  { href: "/relatorios", label: "Relatórios", icon: "FileBarChart" as const },
  { href: "/configuracoes", label: "Configurações", icon: "Settings" as const, advogadoOnly: true },
];

type BadgeCounts = { aprovacoes: number; prazos: number };

function useBadgeCounts(): BadgeCounts {
  const [counts, setCounts] = useState<BadgeCounts>({ aprovacoes: 0, prazos: 0 });

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const hoje = new Date();
    const em7dias = new Date(hoje.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [aprov, prazos] = await Promise.all([
      supabase
        .from("aprovacoes_pendentes")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente"),
      supabase
        .from("app_prazos")
        .select("id", { count: "exact", head: true })
        .eq("concluido", false)
        .lte("data_prazo", em7dias.toISOString().slice(0, 10)),
    ]);
    setCounts({ aprovacoes: aprov.count ?? 0, prazos: prazos.count ?? 0 });
  }, []);

  useEffect(() => {
    refresh();
    const supabase = createClient();
    const channel = supabase
      .channel("nav-badges")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "aprovacoes_pendentes" },
        () => refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_prazos" },
        () => refresh()
      )
      .subscribe();
    const interval = setInterval(refresh, 60000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [refresh]);

  return counts;
}

function NavLinks({
  counts,
  onNavigate,
  papel,
}: {
  counts: BadgeCounts;
  onNavigate?: () => void;
  papel?: AppUser["papel"];
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {navItems
        .filter((item) => !item.advogadoOnly || papel === "advogado")
        .map((item) => {
        const Icon = icons[item.icon];
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        const badgeCount = item.badge ? counts[item.badge] : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1">{item.label}</span>
            {badgeCount > 0 && (
              <Badge
                variant={active ? "secondary" : "destructive"}
                className="h-5 min-w-5 justify-center px-1.5 text-[11px]"
              >
                {badgeCount}
              </Badge>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ user, children }: { user: AppUser; children: React.ReactNode }) {
  const counts = useBadgeCounts();

  return (
    <NotificationsProvider>
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4">
          <Sheet>
            <SheetTrigger
              className={cn(buttonVariants({ variant: "outline", size: "icon" }), "lg:hidden")}
              aria-label="Abrir menu"
            >
              <Menu className="h-4 w-4" />
            </SheetTrigger>
            <SheetContent side="left" className="w-72">
              <div className="mb-4">
                <p className="font-semibold">{APP_NAME}</p>
                <p className="text-xs text-muted-foreground">Painel do escritório</p>
              </div>
              <NavLinks counts={counts} papel={user.papel} />
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">{APP_NAME}</p>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Direito previdenciário
            </p>
          </div>
          <GlobalSearch />
          <NotificationsBell />
          <Badge variant="secondary" className="hidden sm:inline-flex capitalize">
            {user.papel}
          </Badge>
          <ThemeToggle />
          <form action={signOut}>
            <Button variant="ghost" size="icon" type="submit" aria-label="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </header>

      <div className="flex">
        <aside className="hidden w-64 shrink-0 border-r lg:block">
          <div className="sticky top-14 p-4">
            <div className="mb-4 rounded-lg bg-muted/50 p-3">
              <p className="text-sm font-medium">{user.nome}</p>
              <p className="text-xs text-muted-foreground capitalize">{user.papel}</p>
            </div>
            <NavLinks counts={counts} papel={user.papel} />
          </div>
        </aside>
        <main className="flex-1 p-4 pb-20 lg:p-6">{children}</main>
      </div>
    </div>
    </NotificationsProvider>
  );
}
