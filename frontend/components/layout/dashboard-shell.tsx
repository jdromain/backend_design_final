"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  HelpCircle,
  History,
  LogOut,
  Puzzle,
  Search,
  Settings,
  TrendingUp,
  User,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { GlobalSearch } from "@/components/global-search";
import { NotificationCenter } from "@/components/notification-center";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RezovoaiLogo } from "@/components/rezovoai-logo";
import { navigateAppPage } from "@/hooks/use-app-navigate";
import { clearAuthToken } from "@/lib/api-client";

const clerkPublishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();

type NavItem = {
  href: string;
  pageId: string;
  label: string;
  icon: typeof BarChart3;
  shortcut: number;
};

const PRIMARY_NAV: NavItem[] = [
  { href: "/", pageId: "dashboard", label: "Dashboard", icon: BarChart3, shortcut: 1 },
  { href: "/live", pageId: "live", label: "Live", icon: Activity, shortcut: 2 },
  { href: "/history", pageId: "history", label: "Call History", icon: History, shortcut: 3 },
  { href: "/actions", pageId: "actions", label: "Actions", icon: Zap, shortcut: 4 },
  { href: "/analytics", pageId: "analytics", label: "Analytics", icon: TrendingUp, shortcut: 5 },
  { href: "/agents", pageId: "agents", label: "Agent", icon: Bot, shortcut: 6 },
  { href: "/knowledge", pageId: "knowledge", label: "Knowledge Base", icon: BookOpen, shortcut: 7 },
  { href: "/integrations", pageId: "integrations", label: "Integrations", icon: Puzzle, shortcut: 8 },
  { href: "/billing", pageId: "billing", label: "Billing", icon: CreditCard, shortcut: 9 },
];

const SIDEBAR_COLLAPSED_KEY = "dashboard_sidebar_collapsed";

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== "undefined" && localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") {
        setSidebarCollapsed(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  const handleNavigateFromSearch = useCallback(
    (page: string, queryParams?: Record<string, string>) => {
      navigateAppPage(router, page, queryParams);
      setSearchOpen(false);
    },
    [router]
  );

  const handleLogout = useCallback(() => {
    clearAuthToken();
    router.push("/dev-login");
  }, [router]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "b") {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        setSidebarCollapsed((c) => !c);
        return;
      }
      if (mod && /^[1-9]$/.test(e.key)) {
        if (isEditableTarget(e.target)) return;
        const n = Number(e.key);
        const item = PRIMARY_NAV.find((i) => i.shortcut === n);
        if (item) {
          e.preventDefault();
          router.push(item.href);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  const navLinkClass = (active: boolean) =>
    cn(
      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      sidebarCollapsed && "justify-center px-2",
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    );

  const renderNavLink = (item: NavItem) => {
    const isActive =
      pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
    const shortcutLabel = `⌘${item.shortcut}`;
    const link = (
      <Link href={item.href} className={navLinkClass(isActive)} title={sidebarCollapsed ? item.label : undefined}>
        <item.icon className="h-5 w-5 shrink-0" />
        {!sidebarCollapsed && (
          <span className="flex flex-1 items-center justify-between gap-2 truncate">
            <span className="truncate">{item.label}</span>
            <span className="hidden text-[10px] font-normal opacity-60 lg:inline">{shortcutLabel}</span>
          </span>
        )}
      </Link>
    );

    if (!sidebarCollapsed) return <div key={item.href}>{link}</div>;

    return (
      <Tooltip key={item.href}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">
          {item.label} ({shortcutLabel})
        </TooltipContent>
      </Tooltip>
    );
  };

  const footerLink = (href: string, label: string, Icon: typeof Settings, activeMatch: (p: string) => boolean) => {
    const active = activeMatch(pathname);
    const inner = (
      <Link href={href} className={navLinkClass(active)} title={sidebarCollapsed ? label : undefined}>
        <Icon className="h-5 w-5 shrink-0" />
        {!sidebarCollapsed && label}
      </Link>
    );
    if (!sidebarCollapsed) return <div key={href}>{inner}</div>;
    return (
      <Tooltip key={href}>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-screen overflow-hidden">
        <aside
          className={cn(
            "fixed left-0 top-0 z-40 flex h-screen flex-col border-r bg-card transition-[width] duration-200 ease-out",
            sidebarCollapsed ? "w-16" : "w-64"
          )}
        >
          <div
            className={cn(
              "flex h-16 shrink-0 items-center border-b px-3",
              sidebarCollapsed ? "justify-center" : "px-4"
            )}
          >
            {sidebarCollapsed ? (
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <RezovoaiLogo size={22} className="text-primary-foreground" />
              </div>
            ) : (
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Rezovoai</p>
                <h1 className="truncate text-lg font-bold tracking-tight">REZOVOAI</h1>
              </div>
            )}
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto p-3">{PRIMARY_NAV.map(renderNavLink)}</div>

          <Separator />
          <div className="space-y-1 p-3">
            {footerLink("/settings", "Settings", Settings, (p) => p.startsWith("/settings"))}
            {footerLink("/help", "Help & Support", HelpCircle, (p) => p.startsWith("/help"))}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed((c) => !c)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                    sidebarCollapsed && "justify-center px-2"
                  )}
                  aria-expanded={!sidebarCollapsed}
                >
                  {sidebarCollapsed ? (
                    <ChevronRight className="h-5 w-5 shrink-0" />
                  ) : (
                    <>
                      <ChevronLeft className="h-5 w-5 shrink-0" />
                      <span className="flex flex-1 items-center justify-between gap-2">
                        <span>Collapse</span>
                        <span className="hidden text-[10px] font-normal opacity-60 lg:inline">⌘B</span>
                      </span>
                    </>
                  )}
                </button>
              </TooltipTrigger>
              {sidebarCollapsed && (
                <TooltipContent side="right">Expand sidebar (⌘B)</TooltipContent>
              )}
            </Tooltip>
          </div>
        </aside>

        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col overflow-hidden transition-[margin] duration-200 ease-out",
            sidebarCollapsed ? "ml-16" : "ml-64"
          )}
        >
          <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-card px-4 md:px-6">
            <div className="min-w-0 flex-1">
              <Button
                variant="outline"
                className="w-full max-w-md justify-start text-muted-foreground"
                onClick={() => setSearchOpen(true)}
                type="button"
              >
                <Search className="mr-2 h-4 w-4 shrink-0" />
                <span className="truncate">Search…</span>
                <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </Button>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggle />
              <NotificationCenter open={notificationsOpen} onOpenChange={setNotificationsOpen} />
              {clerkPublishableKey ? (
                <UserButton afterSignOutUrl="/sign-in" />
              ) : (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback>JD</AvatarFallback>
                        </Avatar>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuLabel>John Doe</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link href="/settings">
                          <User className="mr-2 h-4 w-4" />
                          Profile
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/billing">
                          <CreditCard className="mr-2 h-4 w-4" />
                          Billing
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/settings">
                          <Settings className="mr-2 h-4 w-4" />
                          Settings
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setLogoutConfirmOpen(true)}
                        className="text-destructive focus:text-destructive"
                      >
                        <LogOut className="mr-2 h-4 w-4" />
                        Log out
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <ConfirmDialog
                    open={logoutConfirmOpen}
                    onOpenChange={setLogoutConfirmOpen}
                    title="Log out"
                    description="You will need to sign in again to access the dashboard."
                    confirmLabel="Log out"
                    variant="destructive"
                    onConfirm={handleLogout}
                  />
                </>
              )}
            </div>
          </header>

          <main className="flex-1 overflow-y-auto bg-background p-6">{children}</main>
        </div>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} onNavigate={handleNavigateFromSearch} />
    </TooltipProvider>
  );
}
