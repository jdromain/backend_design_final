"use client";

import { useAuth } from "@clerk/nextjs";
import { CubeLoader } from "@/components/ui/cube-loader";
import { isClerkConfigured } from "@/lib/clerk-runtime";

type DashboardClerkAuthShellProps = {
  children: React.ReactNode;
  /** True while waitForAuthReady + dashboard fetches are in flight */
  dataLoading: boolean;
};

/**
 * When Clerk is enabled: shows explicit loading for session bootstrap (!isLoaded)
 * and a compact banner while dashboard API calls run after the token is ready.
 * When Clerk is off, renders children unchanged (no useAuth — avoids provider requirement in dev).
 */
export function DashboardClerkAuthShell({
  children,
  dataLoading,
}: DashboardClerkAuthShellProps) {
  if (!isClerkConfigured()) {
    return <>{children}</>;
  }
  return (
    <DashboardClerkAuthInner dataLoading={dataLoading}>{children}</DashboardClerkAuthInner>
  );
}

function DashboardClerkAuthInner({
  children,
  dataLoading,
}: DashboardClerkAuthShellProps) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-lg border border-border bg-muted/20 p-8">
        <CubeLoader aria-label="Loading session" />
        <p className="text-sm text-muted-foreground">Preparing your session…</p>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-lg border border-border bg-muted/20 p-8">
        <CubeLoader aria-label="Redirecting to sign in" />
        <p className="text-sm text-muted-foreground">Redirecting to sign in…</p>
      </div>
    );
  }

  return (
    <>
      {dataLoading ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center">
            <div className="scale-50">
              <CubeLoader aria-label="Loading dashboard" />
            </div>
          </div>
          <span>Connecting to the API…</span>
        </div>
      ) : null}
      {children}
    </>
  );
}
