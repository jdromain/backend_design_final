"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

/** Page ids used by `GlobalSearch` and legacy main UI navigation. */
export const APP_PAGE_ROUTES: Record<string, string> = {
  dashboard: "/",
  live: "/live",
  history: "/history",
  actions: "/actions",
  analytics: "/analytics",
  agents: "/agents",
  knowledge: "/knowledge",
  integrations: "/integrations",
  billing: "/billing",
  settings: "/settings",
  help: "/help",
};

type AppRouterPush = { push: (href: string) => void };

/** Same routing rules as `useAppNavigate`, for use outside hooks (e.g. keyboard handlers). */
export function navigateAppPage(
  router: AppRouterPush,
  page: string,
  params?: Record<string, string>
): void {
  if (page.startsWith("agent:")) {
    router.push(`/agents/${page.slice("agent:".length)}`);
    return;
  }
  const base = APP_PAGE_ROUTES[page];
  if (!base) return;
  const q = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") q.set(k, v);
    }
  }
  const qs = q.toString();
  router.push(qs ? `${base}?${qs}` : base);
}

/** Maps main UI “page ids” from `Backend-design-mainui` to App Router paths. */
export function useAppNavigate() {
  const router = useRouter();

  return useCallback(
    (page: string, params?: Record<string, string>) => {
      navigateAppPage(router, page, params);
    },
    [router]
  );
}
