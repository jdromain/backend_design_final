import { createLogger } from "@rezovo/logging";

const logger = createLogger({ service: "jobs", module: "staleCallReconciler" });

const DEFAULT_PLATFORM_API_URL = "http://localhost:3001";
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_THRESHOLD_MINUTES = 15;
const DEFAULT_LOCAL_INTERNAL_TOKEN = "rezovo-local-internal-token";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function runReconcile(platformApiUrl: string, thresholdMinutes: number): Promise<void> {
  const token =
    process.env.INTERNAL_SERVICE_TOKEN ??
    process.env.PLATFORM_API_INTERNAL_TOKEN ??
    DEFAULT_LOCAL_INTERNAL_TOKEN;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token.trim().length > 0) {
    headers.Authorization = `Bearer ${token}`;
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(`${platformApiUrl}/calls/reconcile-stale`, {
      method: "POST",
      headers,
      body: JSON.stringify({ thresholdMinutes }),
    });
    const durationMs = Date.now() - startedAt;
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.warn("stale call reconcile request failed", {
        status: response.status,
        durationMs,
        body: body.slice(0, 300),
      });
      return;
    }

    const payload = (await response.json().catch(() => null)) as
      | { data?: { closedCount?: number; scope?: string; thresholdMinutes?: number } }
      | null;
    logger.info("stale call reconcile completed", {
      closedCount: payload?.data?.closedCount ?? 0,
      scope: payload?.data?.scope ?? "unknown",
      thresholdMinutes: payload?.data?.thresholdMinutes ?? thresholdMinutes,
      durationMs,
    });
  } catch (error) {
    logger.warn("stale call reconcile request error", {
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    });
  }
}

export function startStaleCallReconciler(): void {
  const platformApiUrl = process.env.PLATFORM_API_URL || DEFAULT_PLATFORM_API_URL;
  const intervalMs = intFromEnv("STALE_CALL_RECONCILE_INTERVAL_MS", DEFAULT_INTERVAL_MS);
  const thresholdMinutes = intFromEnv(
    "STALE_CALL_THRESHOLD_MINUTES",
    DEFAULT_THRESHOLD_MINUTES,
  );

  void runReconcile(platformApiUrl, thresholdMinutes);
  setInterval(() => {
    void runReconcile(platformApiUrl, thresholdMinutes);
  }, Math.max(60_000, intervalMs)).unref?.();

  logger.info("stale call reconciler started", {
    platformApiUrl,
    intervalMs: Math.max(60_000, intervalMs),
    thresholdMinutes,
  });
}
