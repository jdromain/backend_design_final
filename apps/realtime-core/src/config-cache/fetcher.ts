import { AgentConfigSnapshot, PhoneNumberConfig, PlanSnapshot } from "@rezovo/core-types";
import { env } from "../env";
import { internalApiHeaders } from "../platformApiAuth";
import { internalFetch } from "../http/internalFetch";

export type ConfigSnapshotResponse = {
  orgId: string;
  lob: string;
  version: number;
  status: "draft" | "published";
  agentConfig: AgentConfigSnapshot;
  phoneNumbers: PhoneNumberConfig[];
  plan: PlanSnapshot;
};

export async function fetchConfigSnapshot(orgId: string, lob = "default"): Promise<ConfigSnapshotResponse> {
  const base = env.PLATFORM_API_URL;
  const url = new URL("/config/snapshot", base);
  url.searchParams.set("orgId", orgId);
  url.searchParams.set("lob", lob);

  const res = await internalFetch(url.toString(), {
    method: "GET",
    headers: internalApiHeaders(),
    timeoutMs: 2_000,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch snapshot: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ConfigSnapshotResponse;
}
