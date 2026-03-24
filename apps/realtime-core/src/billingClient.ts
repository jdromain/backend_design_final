import { env } from "./env";

export type BillingQuotaResponse = {
  allowed: boolean;
  reason?: string;
  active?: number;
};

export class BillingQuotaClient {
  private baseUrl: string;

  constructor(opts?: { baseUrl?: string }) {
    this.baseUrl = opts?.baseUrl ?? env.PLATFORM_API_URL;
  }

  async canStartCall(tenantId: string): Promise<BillingQuotaResponse> {
    const res = await fetch(`${this.baseUrl}/billing-quota/can-start-call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tenantId })
    });
    if (!res.ok) {
      throw new Error(`billing quota failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as BillingQuotaResponse;
  }
}
