import { env } from "./env";
import { internalApiHeaders } from "./platformApiAuth";
import { internalFetch } from "./http/internalFetch";

export type RetrieveRequest = {
  org_id: string;
  business_id: string;
  namespace: string;
  query: string;
  topK?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function retrieveKb(req: RetrieveRequest): Promise<{ passages: Array<{ text: string }> }> {
  const base = env.PLATFORM_API_URL;
  const res = await internalFetch(`${base}/kb/retrieve`, {
    method: "POST",
    headers: internalApiHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(req),
    signal: req.signal,
    timeoutMs: req.timeoutMs ?? 500,
  });
  if (!res.ok) {
    throw new Error(`KB retrieve failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { passages: Array<{ text: string }> };
}
