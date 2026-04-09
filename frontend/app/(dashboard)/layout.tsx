import { DashboardShell } from "@/components/layout/dashboard-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { RouteErrorBoundary } from "@/components/route-error-boundary";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary>
      <DashboardShell>
        <RouteErrorBoundary>{children}</RouteErrorBoundary>
      </DashboardShell>
    </ErrorBoundary>
  );
}
