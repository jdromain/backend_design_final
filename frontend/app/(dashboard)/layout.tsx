import { DashboardShell } from "@/components/layout/dashboard-shell";
import { ErrorBoundary } from "@/components/error-boundary";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary>
      <DashboardShell>
        <ErrorBoundary>{children}</ErrorBoundary>
      </DashboardShell>
    </ErrorBoundary>
  );
}

