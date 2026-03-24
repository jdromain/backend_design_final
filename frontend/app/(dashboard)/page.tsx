"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Phone,
  CheckCircle,
  Clock,
  Users,
  XCircle,
  Wrench,
  AlertCircle,
} from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { CallVolumeChart } from "@/components/dashboard/call-volume-chart";
import { RecentCallsTable } from "@/components/dashboard/recent-calls-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";

export default function DashboardPage() {
  // Fetch aggregated analytics
  const { data: analytics, isLoading: analyticsLoading, error: analyticsError } = useQuery({
    queryKey: ["analytics", "aggregate"],
    queryFn: () => api.analytics.getAggregate(),
    refetchInterval: (query) => (query.state.error ? false : 60000),
    retry: 1, // Only retry once to fail fast
  });

  // Fetch recent calls
  const { data: recentCalls = [], isLoading: callsLoading, error: callsError } = useQuery({
    queryKey: ["calls", "recent"],
    queryFn: () => api.analytics.getCalls({ limit: 10 }),
    refetchInterval: (query) => (query.state.error ? false : 30000),
    retry: 1,
  });

  // Fetch active calls count using React Query (replaces useEffect)
  const { data: quota } = useQuery({
    queryKey: ["billing", "quota", "tenant-default"],
    queryFn: () => api.billing.canStartCall("tenant-default"),
    refetchInterval: analyticsError ? false : 10000, // Poll every 10s, stop if backend is down
    retry: 1,
  });

  const activeNow = quota?.currentConcurrency || 0;

  // Generate mock call volume data for the chart
  const callVolumeData = Array.from({ length: 24 }, (_, i) => {
    const hour = new Date();
    hour.setHours(hour.getHours() - (23 - i));
    return {
      time: hour.getHours().toString().padStart(2, "0") + ":00",
      calls: Math.floor(Math.random() * 20) + 5,
    };
  });

  if (analyticsLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  // Show error state if backend is not available
  if (analyticsError) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-16 w-16 text-yellow-500 mb-4" />
            <h3 className="text-xl font-semibold mb-2">Backend Not Available</h3>
            <p className="text-muted-foreground text-center mb-4">
              Unable to connect to the backend API at http://localhost:3001
            </p>
            <p className="text-sm text-muted-foreground text-center">
              Make sure the platform-api service is running on port 3001
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalCalls = analytics?.totalCalls || 0;
  const successRate = analytics?.successRate
    ? (analytics.successRate * 100).toFixed(1)
    : "0.0";
  const avgDuration = analytics?.averageDuration
    ? Math.floor(analytics.averageDuration / 1000)
    : 0;
  const failedCalls = analytics?.failedCalls || 0;
  const toolInvocations = analytics?.toolInvocations || 0;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Calls Today"
          value={totalCalls}
          change={12}
          icon={Phone}
        />
        <MetricCard
          title="Success Rate"
          value={`${successRate}%`}
          change={5}
          icon={CheckCircle}
        />
        <MetricCard
          title="Avg Duration"
          value={`${avgDuration}s`}
          change={-3}
          icon={Clock}
        />
        <MetricCard
          title="Active Now"
          value={activeNow}
          icon={Users}
          description="Concurrent calls"
        />
        <MetricCard
          title="Failed Calls"
          value={failedCalls}
          change={-8}
          icon={XCircle}
        />
        <MetricCard
          title="Tool Invocations"
          value={toolInvocations}
          change={15}
          icon={Wrench}
        />
      </div>

      {/* Call Volume Chart */}
      <CallVolumeChart data={callVolumeData} />

      {/* Recent Calls Table */}
      {callsLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <RecentCallsTable calls={recentCalls} />
      )}
    </div>
  );
}

