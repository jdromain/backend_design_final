"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { api } from "@/lib/api";
import { isClerkConfigured } from "@/lib/clerk-runtime";

export function Header() {
  const { data: healthData, error } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health.get(),
    refetchInterval: (query) => (query.state.error ? false : 30000),
    retry: 1,
  });

  const systemStatus = error ? "error" : (healthData?.status || "unknown");
  const statusColor =
    systemStatus === "ok"
      ? "bg-green-500"
      : systemStatus === "degraded"
      ? "bg-yellow-500"
      : "bg-red-500";
  
  const statusText = error ? "Backend Offline" : systemStatus;

  return (
    <div className="flex h-16 items-center justify-between border-b bg-card px-6">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold">Voice Platform</h2>
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${statusColor}`} />
          <span className="text-sm text-muted-foreground capitalize">
            {statusText}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Button variant="ghost" size="icon">
          <Bell className="h-5 w-5" />
        </Button>

        {isClerkConfigured() ? (
          <UserButton afterSignOutUrl="/sign-in" />
        ) : (
          <Button variant="outline" size="sm" asChild>
            <Link href="/dev-login">Account</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
