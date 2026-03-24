import { AgentConfigSnapshot, PhoneNumberConfig, PlanSnapshot } from "@rezovo/core-types";
import { env } from "../env";

export type ConfigSnapshotResponse = {
  tenantId: string;
  lob: string;
  version: number;
  status: "draft" | "published";
  agentConfig: AgentConfigSnapshot;
  phoneNumbers: PhoneNumberConfig[];
  plan: PlanSnapshot;
};

export async function fetchConfigSnapshot(tenantId: string, lob = "default"): Promise<ConfigSnapshotResponse> {
  const base = env.PLATFORM_API_URL;
  const url = new URL("/config/snapshot", base);
  url.searchParams.set("tenantId", tenantId);
  url.searchParams.set("lob", lob);

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    throw new Error(`Failed to fetch snapshot: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ConfigSnapshotResponse;
}
