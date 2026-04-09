import { env } from "./env";

export function internalApiHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (env.INTERNAL_SERVICE_TOKEN) {
    headers.Authorization = `Bearer ${env.INTERNAL_SERVICE_TOKEN}`;
  }
  return headers;
}
