"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Phone, Clock, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { CallRecord } from "@/lib/types";
import { formatDistance } from "date-fns";

function LiveCallCard({ call }: { call: CallRecord }) {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const startTime = new Date(call.startedAt).getTime();
    const updateDuration = () => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTime) / 1000);
      setDuration(elapsed);
    };

    updateDuration();
    const interval = setInterval(updateDuration, 1000);
    return () => clearInterval(interval);
  }, [call.startedAt]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Phone className="h-4 w-4" />
              <span className="absolute -right-1 -top-1 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
              </span>
            </div>
            <span>Active Call</span>
          </div>
        </CardTitle>
        <Badge variant="default">Live</Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono">{call.callerNumber || "Unknown"}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono font-bold text-lg">{formatDuration(duration)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Started {formatDistance(new Date(call.startedAt), new Date(), { addSuffix: true })}
          </div>
          {call.toolsUsed && call.toolsUsed.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Tools used: {call.toolsUsed.join(", ")}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SystemStatusPanel() {
  const { data: health, isLoading, error } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health.get(),
    refetchInterval: (query) => (query.state.error ? false : 5000),
    retry: 1,
  });

  if (isLoading) {
    return <Skeleton className="h-64" />;
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ok":
        return "bg-green-500";
      case "disabled":
        return "bg-gray-400";
      case "error":
        return "bg-red-500";
      default:
        return "bg-yellow-500";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>System Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {health?.services &&
            Object.entries(health.services).map(([service, status]) => (
              <div
                key={service}
                className="flex items-center justify-between border-b pb-2 last:border-0"
              >
                <span className="text-sm capitalize">
                  {service.replace(/_/g, " ")}
                </span>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${getStatusColor(status)}`} />
                  <span className="text-xs text-muted-foreground capitalize">
                    {status}
                  </span>
                </div>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function LiveCallsPage() {
  const { data: allCalls = [], isLoading, error } = useQuery({
    queryKey: ["calls", "all"],
    queryFn: () => api.analytics.getCalls({ limit: 100 }),
    refetchInterval: (query) => (query.state.error ? false : 5000),
    retry: 1,
  });

  // Filter for active calls (no endedAt timestamp)
  const activeCalls = allCalls.filter((call) => !call.endedAt);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Live Calls</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Live Calls</h1>
        <Badge variant="outline" className="text-lg px-4 py-2">
          {activeCalls.length} Active
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {activeCalls.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Phone className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">No Active Calls</h3>
              <p className="text-muted-foreground text-center">
                When calls are in progress, they will appear here in real-time.
              </p>
            </CardContent>
          </Card>
        ) : (
          activeCalls.map((call) => <LiveCallCard key={call.callId} call={call} />)
        )}

        <div className="md:col-span-2 lg:col-span-1">
          <SystemStatusPanel />
        </div>
      </div>
    </div>
  );
}

