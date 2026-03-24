type TenantKey = string;

export type CallAggregate = {
  calls: number;
  totalDurationMs: number;
  transfers: number;
  voicemail: number;
};

export type ToolAggregate = {
  toolName: string;
  count: number;
};

export class AnalyticsStore {
  private calls = new Map<TenantKey, CallAggregate>();
  private tools = new Map<TenantKey, Map<string, number>>();

  recordCall(tenantId: string, durationMs: number, outcome?: string) {
    const agg = this.calls.get(tenantId) ?? { calls: 0, totalDurationMs: 0, transfers: 0, voicemail: 0 };
    agg.calls += 1;
    agg.totalDurationMs += durationMs;
    if (outcome === "transferred") agg.transfers += 1;
    if (outcome === "voicemail") agg.voicemail += 1;
    this.calls.set(tenantId, agg);
  }

  recordTool(tenantId: string, toolName: string) {
    const map = this.tools.get(tenantId) ?? new Map<string, number>();
    map.set(toolName, (map.get(toolName) ?? 0) + 1);
    this.tools.set(tenantId, map);
  }

  hydrateCalls(records: Array<{ tenantId: string; durationMs: number; outcome?: string }>) {
    for (const r of records) {
      this.recordCall(r.tenantId, r.durationMs, r.outcome);
    }
  }

  hydrateTools(records: Array<{ tenantId: string; toolName: string; count: number }>) {
    for (const r of records) {
      const map = this.tools.get(r.tenantId) ?? new Map<string, number>();
      map.set(r.toolName, (map.get(r.toolName) ?? 0) + r.count);
      this.tools.set(r.tenantId, map);
    }
  }

  getCallSummary(tenantId: string) {
    return this.calls.get(tenantId) ?? { calls: 0, totalDurationMs: 0, transfers: 0, voicemail: 0 };
  }

  getToolSummary(tenantId: string) {
    const map = this.tools.get(tenantId) ?? new Map<string, number>();
    return [...map.entries()].map(([toolName, count]) => ({ toolName, count }));
  }
}

