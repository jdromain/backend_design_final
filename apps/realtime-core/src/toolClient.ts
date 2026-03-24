import { randomUUID } from "crypto";
import { env } from "./env";

export async function callTool(opts: {
  tenantId: string;
  toolName: string;
  args: Record<string, unknown>;
  platformApiUrl?: string;
  idempotencyKey?: string;
}): Promise<unknown> {
  const base = opts.platformApiUrl || env.PLATFORM_API_URL;
  const url = new URL("/tool/call", base);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tenantId: opts.tenantId,
      toolName: opts.toolName,
      idempotencyKey: opts.idempotencyKey ?? randomUUID(),
      args: opts.args
    })
  });
  if (!res.ok) {
    throw new Error(`Tool call failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json.result ?? json;
}
