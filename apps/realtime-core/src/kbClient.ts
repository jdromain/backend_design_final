import { env } from "./env";

export type RetrieveRequest = {
  tenant_id: string;
  business_id: string;
  namespace: string;
  query: string;
  topK?: number;
};

export async function retrieveKb(req: RetrieveRequest): Promise<{ passages: Array<{ text: string }> }> {
  const base = env.PLATFORM_API_URL;
  const res = await fetch(`${base}/kb/retrieve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(req)
  });
  if (!res.ok) {
    throw new Error(`KB retrieve failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { passages: Array<{ text: string }> };
}
