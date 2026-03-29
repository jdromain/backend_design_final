"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Phone,
  History,
  BarChart3,
  Bot,
  BookOpen,
  Puzzle,
  CreditCard,
  Settings,
  Zap,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Active Calls", href: "/live", icon: Phone },
  { name: "Call History", href: "/history", icon: History },
  { name: "Actions", href: "/actions", icon: Zap },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "AI Agents", href: "/agents", icon: Bot },
  { name: "Knowledge Base", href: "/knowledge", icon: BookOpen },
  { name: "Integrations", href: "/integrations", icon: Puzzle },
  { name: "Billing", href: "/billing", icon: CreditCard },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center border-b px-6">
        <h1 className="text-xl font-bold tracking-tight">REZOVOAI</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <nav className="space-y-1">
          {navigation.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>
      <Separator />
      <div className="space-y-1 p-4">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/settings")
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          <Settings className="h-5 w-5" />
          Settings
        </Link>
        <Link
          href="/help"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/help")
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          <HelpCircle className="h-5 w-5" />
          Help &amp; Support
        </Link>
      </div>
    </div>
  );
}
