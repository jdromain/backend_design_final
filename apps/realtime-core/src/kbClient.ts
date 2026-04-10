import { env } from "./env";
import { internalApiHeaders } from "./platformApiAuth";

export type RetrieveRequest = {
  org_id: string;
  business_id: string;
  namespace: string;
  query: string;
  topK?: number;
};

export async function retrieveKb(req: RetrieveRequest): Promise<{ passages: Array<{ text: string }> }> {
  const base = env.PLATFORM_API_URL;
  const res = await fetch(`${base}/kb/retrieve`, {
    method: "POST",
    headers: internalApiHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(req)
  });
  if (!res.ok) {
    throw new Error(`KB retrieve failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { passages: Array<{ text: string }> };
}
