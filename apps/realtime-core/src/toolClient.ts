import { createHash } from "crypto";
import { env } from "./env";
import { internalApiHeaders } from "./platformApiAuth";
import { internalFetch } from "./http/internalFetch";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",");
  return `{${body}}`;
}

function defaultIdempotencyKey(callId: string, toolName: string, args: Record<string, unknown>): string {
  return createHash("sha256")
    .update(`${callId}|${toolName}|${stableStringify(args)}`)
    .digest("hex")
    .slice(0, 24);
}

export async function callTool(opts: {
  orgId: string;
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  platformApiUrl?: string;
  idempotencyKey?: string;
}): Promise<unknown> {
  const base = opts.platformApiUrl || env.PLATFORM_API_URL;
  const url = new URL("/tool/call", base);
  const idempotencyKey = opts.idempotencyKey ?? defaultIdempotencyKey(opts.callId, opts.toolName, opts.args);
  const res = await internalFetch(url.toString(), {
    method: "POST",
    headers: internalApiHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      orgId: opts.orgId,
      toolName: opts.toolName,
      idempotencyKey,
      args: opts.args
    }),
    timeoutMs: 4_000,
  });
  if (!res.ok) {
    throw new Error(`Tool call failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json.result ?? json;
}
