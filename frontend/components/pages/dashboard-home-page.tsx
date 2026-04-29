"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { subDays } from "date-fns";
import { isClerkConfigured } from "@/lib/clerk-runtime";
import {
  Phone,
  CheckCircle,
  Users,
  XCircle,
  MessageSquare,
  ArrowDownUp,
  XOctagon,
  Gauge,
} from "lucide-react";
import { GlobalOpsControlsBar, type DateRangeValue } from "@/components/dashboard/global-ops-controls-bar";
import { SystemHealthModal, type SystemHealthData } from "@/components/dashboard/system-health-modal";
import { KpiTile } from "@/components/dashboard/kpi-tile";
import { OutcomesChart } from "@/components/dashboard/outcomes-chart";
import { RecentActivityFeed } from "@/components/dashboard/recent-activity-feed";
import { CallsTable, type QuickFilter } from "@/components/dashboard/calls-table";
import type { CallRecord } from "@/types/api";
import { CallDetailDrawer } from "@/components/dashboard/call-detail-drawer";
import { NeedsAttentionPanel, type Incident } from "@/components/dashboard/needs-attention-panel";
import { InsightsCard, type InsightItem } from "@/components/dashboard/insights-card";
import { OnboardingChecklist, type OnboardingStep } from "@/components/dashboard/onboarding-checklist";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { ErrorBoundary } from "@/components/error-boundary";
import { KpiRowSkeleton, ChartSkeleton, TableSkeleton } from "@/components/loading-skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAppNavigate } from "@/hooks/use-app-navigate";
import {
  getDashboardOutcomesByRange,
  getDashboardCalls,
  getDashboardActivity,
  getSparklineData,
  getSystemHealth,
  getIncidents,
  getTopIntents,
  getTopHandoffReasons,
  getTopFailureReasons,
  getOnboardingSteps,
} from "@/lib/data/dashboard";
import { waitForAuthReady } from "@/lib/api-client";
import { sparklinePercentDelta } from "@/lib/sparkline-delta";

/**
 * Main UI dashboard body from `Backend-design-mainui` `app/page.tsx`, adapted
 * for App Router (navigation uses `useAppNavigate` instead of local tab state).
 */
export function DashboardHomePage() {
  const handleNavigate = useAppNavigate();
  const { toast } = useToast();

  const [dateRange, setDateRange] = useState<DateRangeValue>(() => {
    const to = new Date();
    return { from: subDays(to, 7), to };
  });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [outcomesGranularity, setOutcomesGranularity] = useState<"hour" | "day" | "week">("hour");
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [activeKpi, setActiveKpi] = useState<string | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [callDrawerOpen, setCallDrawerOpen] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const clerkRetryRef = useRef(0);

  type OutcomesData = Awaited<ReturnType<typeof getDashboardOutcomesByRange>>;
  type CallsData = Awaited<ReturnType<typeof getDashboardCalls>>;
  type ActivityData = Awaited<ReturnType<typeof getDashboardActivity>>;

  const [outcomesData, setOutcomesData] = useState<OutcomesData>([]);
  const [callsData, setCallsData] = useState<CallsData>([]);
  const [activityData, setActivityData] = useState<ActivityData>([]);
  const [sparklineData, setSparklineData] = useState<
    Awaited<ReturnType<typeof getSparklineData>>
  >({
    calls: [],
    active: [],
    completed: [],
    failed: [],
    handoff: [],
    dropped: [],
    latency: [],
  });
  const [systemHealth, setSystemHealth] = useState<SystemHealthData | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [topIntents, setTopIntents] = useState<InsightItem[]>([]);
  const [topHandoffReasons, setTopHandoffReasons] = useState<InsightItem[]>([]);
  const [topFailureReasons, setTopFailureReasons] = useState<InsightItem[]>([]);
  const [onboardingSteps, setOnboardingSteps] = useState<OnboardingStep[]>([]);

  useEffect(() => {
    const onUnauthorized = () => {
      if (typeof window === "undefined") return;
      if (isClerkConfigured()) {
        // In Clerk mode a 401 usually means the Clerk session token wasn't
        // ready when the dashboard first mounted (race with ClerkTokenBridge).
        // Auto-retry up to 3 times with increasing delays before giving up.
        clerkRetryRef.current += 1;
        if (clerkRetryRef.current <= 3) {
          const delay = clerkRetryRef.current * 1000;
          setTimeout(() => {
            setDashboardError(null);
            setDashboardLoading(true);
            setFetchKey((k) => k + 1);
          }, delay);
        } else {
          setDashboardError(
            "API returned 401. Confirm the 'platform-api' JWT template exists in Clerk Dashboard (Configure → JWT Templates) and that your account is a member of the linked organisation."
          );
        }
        return;
      }
      window.location.href = "/sign-in";
    };
    window.addEventListener("rezovo:unauthorized", onUnauthorized);
    return () => window.removeEventListener("rezovo:unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    const onTemplateMissing = (event: Event) => {
      const custom = event as CustomEvent<{ template?: string }>;
      const template = custom.detail?.template ?? "platform-api";
      toast({
        title: "Clerk JWT template missing",
        description: `Create Clerk JWT template "${template}" so API calls can use a scoped token. Using fallback session token for now.`,
        variant: "destructive",
      });
    };
    window.addEventListener("rezovo:clerk-template-missing", onTemplateMissing);
    return () => window.removeEventListener("rezovo:clerk-template-missing", onTemplateMissing);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;

    waitForAuthReady().then(() => {
      if (cancelled) return;
      Promise.all([
        getDashboardOutcomesByRange({
          from: dateRange.from,
          to: dateRange.to,
          granularity: outcomesGranularity,
        }),
        getDashboardCalls({
          from: dateRange.from,
          to: dateRange.to,
          limit: 500,
        }),
        getDashboardActivity(),
        getSparklineData(),
        getSystemHealth(),
        getIncidents(),
        getTopIntents(),
        getTopHandoffReasons(),
        getTopFailureReasons(),
        getOnboardingSteps(),
      ])
        .then(
          ([
            outcomes,
            calls,
            activity,
            spark,
            health,
            inc,
            intents,
            handoffs,
            failures,
            steps,
          ]) => {
            if (cancelled) return;
            setOutcomesData(outcomes);
            setCallsData(calls);
            setActivityData(activity);
            setSparklineData(spark);
            setSystemHealth(health);
            setIncidents(inc);
            setTopIntents(intents as InsightItem[]);
            setTopHandoffReasons(handoffs as InsightItem[]);
            setTopFailureReasons(failures as InsightItem[]);
            setOnboardingSteps(steps as OnboardingStep[]);
            setDashboardLoading(false);
          }
        )
        .catch((err) => {
          if (cancelled) return;
          setDashboardError(err instanceof Error ? err.message : "Failed to load dashboard");
          setDashboardLoading(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [fetchKey, dateRange.from, dateRange.to, outcomesGranularity]);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(() => {
        setLastUpdated(new Date());
        setFetchKey((k) => k + 1);
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const analytics = useMemo(() => {
    const total = callsData.length;
    const completed = callsData.filter((c) => c.result === "completed").length;
    const failed = callsData.filter((c) => c.result === "systemFailed").length;
    const handoff = callsData.filter((c) => c.result === "handoff").length;
    const dropped = callsData.filter((c) => c.result === "dropped").length;
    const lastActive = sparklineData.active.length
      ? sparklineData.active[sparklineData.active.length - 1]
      : 0;
    const lastLat = sparklineData.latency.length
      ? sparklineData.latency[sparklineData.latency.length - 1]
      : 0;
    return {
      totalCalls: total,
      activeNow: lastActive,
      handledRate: total ? Math.round((completed / total) * 100) : 0,
      failureRate: total ? Math.round((failed / total) * 100) : 0,
      failedCount: failed,
      escalationRate: total ? Math.round((handoff / total) * 100) : 0,
      dropRate: total ? Math.round((dropped / total) * 100) : 0,
      p95Latency: Math.round(lastLat),
    };
  }, [callsData, sparklineData]);

  /** % change vs prior hour bucket from sparklines (omitted when fewer than 2 points or prior bucket is 0) */
  const kpiTrendPct = useMemo(
    () => ({
      calls: sparklinePercentDelta(sparklineData.calls),
      active: sparklinePercentDelta(sparklineData.active),
      completed: sparklinePercentDelta(sparklineData.completed),
      handoff: sparklinePercentDelta(sparklineData.handoff),
      dropped: sparklinePercentDelta(sparklineData.dropped),
      failed: sparklinePercentDelta(sparklineData.failed),
      latency: sparklinePercentDelta(sparklineData.latency),
    }),
    [sparklineData]
  );

  const outcomesChartData = useMemo(() => {
    if (outcomesData.length > 0) return outcomesData;
    return [{ time: "—", completed: 0, handoff: 0, dropped: 0, systemFailed: 0 }];
  }, [outcomesData]);

  const isNewUser = callsData.length === 0;

  const handleKpiClick = (kpi: string) => {
    setActiveKpi(activeKpi === kpi ? null : kpi);
    if (kpi === "active") {
      handleNavigate("live");
      return;
    }
    if (kpi === "calls") {
      handleNavigate("history");
      return;
    }
    if (kpi === "failed") setQuickFilter("failed");
    else if (kpi === "handoff") setQuickFilter("handoff");
    else if (kpi === "dropped") setQuickFilter("dropped");
    else if (kpi === "completed") setQuickFilter("completed");
    else setQuickFilter(null);
  };

  const handleCallClick = (call: CallRecord) => {
    setSelectedCall(call);
    setCallDrawerOpen(true);
  };

  const handleExport = () => {
    toast({
      title: "Export started",
      description: "Your data export is being prepared...",
    });
  };

  if (dashboardError) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-destructive">{dashboardError}</p>
        <p className="text-sm text-muted-foreground">
          Confirm platform-api is running and you are signed in with Clerk (
          <Link href="/sign-in" className="underline">
            sign in
          </Link>
          ).
        </p>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">Operations overview and live monitoring</p>
          </div>
          <SystemHealthModal
            data={
              systemHealth ?? {
                overall: "operational",
                telephony: [],
                stt: [],
                tts: [],
                llm: [],
                tools: [],
                integrations: [],
              }
            }
          />
        </div>

        <GlobalOpsControlsBar
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onExport={handleExport}
          lastUpdated={lastUpdated}
          autoRefresh={autoRefresh}
          onAutoRefreshToggle={setAutoRefresh}
        />

        <ErrorBoundary>
          <NeedsAttentionPanel
            incidents={incidents}
            onAction={handleNavigate}
            onViewActivity={() => handleNavigate("history")}
          />
        </ErrorBoundary>

        <ErrorBoundary>
          <QuickActions onNavigate={handleNavigate} />
        </ErrorBoundary>

        <ErrorBoundary>
          {dashboardLoading ? (
            <KpiRowSkeleton count={7} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              <KpiTile
                title="Total Calls"
                value={analytics.totalCalls}
                change={kpiTrendPct.calls}
                icon={Phone}
                sparklineData={sparklineData.calls}
                color="default"
                isActive={activeKpi === "calls"}
                onClick={() => handleKpiClick("calls")}
                tooltip="Total number of calls handled by your AI agent in the selected period"
              />
              <KpiTile
                title="Active Now"
                value={analytics.activeNow}
                change={kpiTrendPct.active}
                icon={Users}
                sparklineData={sparklineData.active}
                color="info"
                pulse
                isActive={activeKpi === "active"}
                onClick={() => handleKpiClick("active")}
                tooltip="Number of calls currently being handled by your AI agent"
              />
              <KpiTile
                title="Completion Rate"
                value={`${analytics.handledRate}%`}
                change={kpiTrendPct.completed}
                icon={CheckCircle}
                sparklineData={sparklineData.completed}
                color="success"
                isActive={activeKpi === "completed"}
                onClick={() => handleKpiClick("completed")}
                tooltip="Percentage of calls successfully resolved without human intervention"
              />
              <KpiTile
                title="Handoff Rate"
                value={`${analytics.escalationRate}%`}
                change={kpiTrendPct.handoff}
                invertTrendColors
                icon={ArrowDownUp}
                sparklineData={sparklineData.handoff}
                color="warning"
                isActive={activeKpi === "handoff"}
                onClick={() => handleKpiClick("handoff")}
                tooltip="Percentage of calls transferred to a human agent"
              />
              <KpiTile
                title="Drop Rate"
                value={`${analytics.dropRate}%`}
                change={kpiTrendPct.dropped}
                invertTrendColors
                icon={XCircle}
                sparklineData={sparklineData.dropped ?? []}
                color="warning"
                isActive={activeKpi === "dropped"}
                onClick={() => handleKpiClick("dropped")}
                tooltip="Percentage of calls where the caller hung up before resolution"
              />
              <KpiTile
                title="System Failure"
                value={`${analytics.failureRate}%`}
                subValue={`${analytics.failedCount} failures`}
                change={kpiTrendPct.failed}
                invertTrendColors
                icon={XOctagon}
                sparklineData={sparklineData.failed}
                color="danger"
                isActive={activeKpi === "failed"}
                onClick={() => handleKpiClick("failed")}
                tooltip="Percentage of calls that failed due to system errors (API timeouts, tool failures)"
              />
              <KpiTile
                title="P95 Latency"
                value={`${analytics.p95Latency}ms`}
                change={kpiTrendPct.latency}
                invertTrendColors
                icon={Gauge}
                sparklineData={sparklineData.latency}
                color="default"
                isActive={activeKpi === "latency"}
                onClick={() => handleKpiClick("latency")}
                tooltip="95th percentile response time from your AI agent (lower is better)"
              />
            </div>
          )}
        </ErrorBoundary>

        <ErrorBoundary>
          {dashboardLoading ? (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <ChartSkeleton />
              </div>
              <div className="lg:col-span-1">
                <ChartSkeleton />
              </div>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <OutcomesChart
                  data={outcomesChartData}
                  granularity={outcomesGranularity}
                  onGranularityChange={setOutcomesGranularity}
                  onSegmentClick={(_time, outcome) => {
                    if (outcome === "systemFailed") setQuickFilter("failed");
                    else if (outcome === "handoff") setQuickFilter("handoff");
                    else if (outcome === "dropped") setQuickFilter("dropped");
                    else if (outcome === "completed") setQuickFilter("completed");
                  }}
                />
              </div>
              <div className="lg:col-span-1">
                <RecentActivityFeed
                  activities={activityData}
                  onActivityClick={(activity) => {
                    if (activity.type === "tool") handleNavigate("integrations");
                    else if (activity.type === "escalation")
                      handleNavigate("history", { filter: "handoff" });
                  }}
                />
              </div>
            </div>
          )}
        </ErrorBoundary>

        <ErrorBoundary>
          <div className="grid gap-4 md:grid-cols-3">
            <InsightsCard
              title="Top Intents"
              icon={<MessageSquare className="h-4 w-4" />}
              items={topIntents}
              onItemClick={(item) => handleNavigate("history", { intent: item.label })}
              emptyMessage="No intent data yet"
            />
            <InsightsCard
              title="Top Handoff Reasons"
              icon={<ArrowDownUp className="h-4 w-4" />}
              items={topHandoffReasons}
              onItemClick={(item) =>
                handleNavigate("history", { filter: "handoff", reason: item.label })
              }
              emptyMessage="No handoffs recorded"
            />
            <InsightsCard
              title="Top Failure Reasons"
              icon={<XOctagon className="h-4 w-4" />}
              items={topFailureReasons}
              onItemClick={(item) =>
                handleNavigate("history", { filter: "failed", reason: item.label })
              }
              emptyMessage="No failures recorded"
            />
          </div>
        </ErrorBoundary>

        <ErrorBoundary>
          {dashboardLoading ? (
            <div className="space-y-3">
              <TableSkeleton rows={6} columns={7} />
            </div>
          ) : isNewUser ? (
            <OnboardingChecklist steps={onboardingSteps} onAction={handleNavigate} />
          ) : (
            <CallsTable
              calls={callsData}
              activeQuickFilter={quickFilter}
              onQuickFilterChange={setQuickFilter}
              onCallClick={handleCallClick}
            />
          )}
        </ErrorBoundary>

        <CallDetailDrawer
          call={selectedCall}
          open={callDrawerOpen}
          onOpenChange={setCallDrawerOpen}
        />
      </div>
    </ErrorBoundary>
  );
}
