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
  CalendarClock,
  Scale,
  Gavel,
  Menu,
  LogOut,
  ChevronDown,
  Settings,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "next-themes";
import { AssistenteDrawer } from "@/components/assistente/assistente-drawer";
import { GlobalSearch } from "@/components/layout/global-search";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { PwaInstallBanner } from "@/components/layout/pwa-install-banner";
import { NotificationsProvider } from "@/components/providers/notifications-provider";
import { AppLogo } from "@/components/layout/app-logo";
import { NAV_GROUPS, type NavIconName } from "@/lib/constants";
import type { AppUser } from "@/lib/actions/auth";
import { signOut } from "@/lib/actions/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const NAV_ICONS: Record<
  NavIconName,
  React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  LayoutDashboard,
  Kanban,
  CheckCircle,
  CalendarClock,
  Scale,
  Gavel,
  Users,
  MessageSquare,
  FileBarChart,
  Settings,
};

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

function userInitials(nome: string): string {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
    <div className="flex flex-col gap-6">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((item) => !item.advogadoOnly || papel === "advogado");
        if (!items.length) return null;
        return (
          <div key={group.title}>
            <p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.2em] text-[#64748B]">
              {group.title}
            </p>
            <nav className="flex flex-col gap-0.5">
              {items.map((item) => {
                const Icon = NAV_ICONS[item.icon];
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
                      "flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-[#0b2148] text-white shadow-[0_8px_24px_rgba(11,33,72,0.22)]"
                        : "text-[#64748B] hover:bg-[#0b2148]/[0.06] hover:text-[#0b2148]"
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        active ? "text-white" : "text-[#64748B]"
                      )}
                      aria-hidden
                    />
                    <span className="flex-1">{item.label}</span>
                    {badgeCount > 0 && (
                      <Badge
                        variant={active ? "secondary" : "destructive"}
                        className={cn(
                          "h-5 min-w-5 justify-center px-1.5 text-[11px]",
                          active && "bg-white/20 text-white hover:bg-white/20"
                        )}
                      >
                        {badgeCount}
                      </Badge>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
        );
      })}
    </div>
  );
}

function UserMenu({ user }: { user: AppUser }) {
  const initials = userInitials(user.nome);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({ variant: "ghost" }),
          "hidden h-auto gap-2 rounded-full py-1.5 pl-1.5 pr-2 sm:flex"
        )}
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-[#0b2148] text-xs font-semibold text-white">
          {initials}
        </span>
        <span className="hidden min-w-0 text-left md:block">
          <span className="block truncate text-sm font-medium leading-tight text-[#0b2148]">
            {user.nome}
          </span>
          <span className="block truncate text-[11px] capitalize text-[#64748B]">
            {user.papel}
          </span>
        </span>
        <ChevronDown className="hidden size-4 text-[#64748B] md:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{user.nome}</p>
          <p className="text-xs capitalize text-muted-foreground">{user.papel}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="p-0 focus:bg-transparent">
          <form action={signOut} className="w-full">
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent"
            >
              <LogOut className="size-4" />
              Sair
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useForceLightTheme() {
  const { setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light") {
      setTheme("light");
    }
  }, [resolvedTheme, setTheme]);
}

export function AppShell({ user, children }: { user: AppUser; children: React.ReactNode }) {
  const counts = useBadgeCounts();
  useForceLightTheme();

  return (
    <NotificationsProvider>
      <div className="min-h-screen bg-[#F1F5F9]">
        <div className="flex h-screen max-h-screen overflow-hidden">
          <aside className="sticky top-0 hidden h-dvh max-h-dvh w-[17.5rem] shrink-0 self-start overflow-hidden border-r border-[#e2e8f0] bg-[#F8FAFC] lg:flex lg:flex-col">
            <div className="shrink-0 border-b border-[#e2e8f0] px-5 py-5">
              <AppLogo />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
              <NavLinks counts={counts} papel={user.papel} />
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <header className="z-40 shrink-0 border-b border-[#e2e8f0] bg-white">
              <div className="grid h-[3.75rem] grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 lg:px-6">
                <div className="flex min-w-0 items-center gap-3">
                <Sheet>
                  <SheetTrigger
                    className={cn(
                      buttonVariants({ variant: "outline", size: "icon" }),
                      "lg:hidden"
                    )}
                    aria-label="Abrir menu"
                  >
                    <Menu className="h-4 w-4" />
                  </SheetTrigger>
                  <SheetContent side="left" className="w-72 border-[#e2e8f0] bg-[#F8FAFC] p-0">
                    <div className="border-b border-[#e2e8f0] px-5 py-4">
                      <AppLogo compact />
                    </div>
                    <div className="px-3 py-4">
                      <NavLinks counts={counts} papel={user.papel} />
                    </div>
                  </SheetContent>
                </Sheet>

                <div className="min-w-0 lg:hidden">
                  <AppLogo compact />
                </div>
                </div>

                <div className="hidden justify-center lg:flex">
                  <GlobalSearch centered />
                </div>

                <div className="col-start-3 flex items-center justify-end justify-self-end gap-2 sm:gap-3">
                  <div className="lg:hidden">
                    <GlobalSearch />
                  </div>
                  <PwaInstallBanner />
                  <div className="flex items-center gap-1.5">
                    <NotificationsBell />
                    <span className="hidden text-sm font-medium text-[#0b2148] sm:inline">
                      Notificações
                    </span>
                  </div>
                  <UserMenu user={user} />
                  <form action={signOut} className="sm:hidden">
                    <Button variant="ghost" size="icon" type="submit" aria-label="Sair">
                      <LogOut className="h-4 w-4" />
                    </Button>
                  </form>
                </div>
              </div>
            </header>

            <main className="min-h-0 flex-1 overflow-y-auto bg-[#F1F5F9] p-4 pb-20 lg:p-6">
              {children}
            </main>
          </div>
        </div>
      </div>
      <AssistenteDrawer />
    </NotificationsProvider>
  );
}
