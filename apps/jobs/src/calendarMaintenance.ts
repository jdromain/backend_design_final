import { createLogger } from "@rezovo/logging";

const logger = createLogger({ service: "jobs", module: "calendarMaintenance" });

const DEFAULT_PLATFORM_API_URL = "http://localhost:3001";
const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_RECONCILE_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_INTERNAL_TOKEN = "rezovo-local-internal-token";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function authHeaders(): Record<string, string> {
  const token =
    process.env.INTERNAL_SERVICE_TOKEN ??
    process.env.PLATFORM_API_INTERNAL_TOKEN ??
    DEFAULT_INTERNAL_TOKEN;
  return {
    "Content-Type": "application/json",
    ...(token.trim().length > 0 ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function runRefresh(platformApiUrl: string): Promise<void> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${platformApiUrl}/integrations/calendar/oauth/refresh-expiring`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    const elapsedMs = Date.now() - startedAt;
    const payload = await response.json().catch(() => null) as { data?: { refreshed?: number; failed?: number } } | null;
    if (!response.ok) {
      logger.warn("calendar oauth refresh request failed", {
        status: response.status,
        elapsedMs,
      });
      return;
    }
    logger.info("calendar oauth refresh completed", {
      refreshed: payload?.data?.refreshed ?? 0,
      failed: payload?.data?.failed ?? 0,
      elapsedMs,
    });
  } catch (error) {
    logger.warn("calendar oauth refresh request error", {
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    });
  }
}

async function runGoogleReconcile(platformApiUrl: string): Promise<void> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${platformApiUrl}/integrations/calendar/reconcile-google`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    const elapsedMs = Date.now() - startedAt;
    const payload = await response.json().catch(() => null) as { data?: { scanned?: number; updated?: number; failed?: number } } | null;
    if (!response.ok) {
      logger.warn("calendar google reconcile request failed", {
        status: response.status,
        elapsedMs,
      });
      return;
    }
    logger.info("calendar google reconcile completed", {
      scanned: payload?.data?.scanned ?? 0,
      updated: payload?.data?.updated ?? 0,
      failed: payload?.data?.failed ?? 0,
      elapsedMs,
    });
  } catch (error) {
    logger.warn("calendar google reconcile request error", {
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    });
  }
}

export function startCalendarMaintenance(): void {
  const platformApiUrl = process.env.PLATFORM_API_URL || DEFAULT_PLATFORM_API_URL;
  const refreshIntervalMs = Math.max(
    60_000,
    intFromEnv("CALENDAR_OAUTH_REFRESH_INTERVAL_MS", DEFAULT_REFRESH_INTERVAL_MS),
  );
  const reconcileIntervalMs = Math.max(
    60_000,
    intFromEnv("CALENDAR_GOOGLE_RECONCILE_INTERVAL_MS", DEFAULT_RECONCILE_INTERVAL_MS),
  );

  void runRefresh(platformApiUrl);
  void runGoogleReconcile(platformApiUrl);

  setInterval(() => {
    void runRefresh(platformApiUrl);
  }, refreshIntervalMs).unref?.();

  setInterval(() => {
    void runGoogleReconcile(platformApiUrl);
  }, reconcileIntervalMs).unref?.();

  logger.info("calendar maintenance started", {
    platformApiUrl,
    refreshIntervalMs,
    reconcileIntervalMs,
  });
}
