import { env } from "./env";
import { internalApiHeaders } from "./platformApiAuth";
import { internalFetch } from "./http/internalFetch";

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

  async canStartCall(orgId: string): Promise<BillingQuotaResponse> {
    const res = await internalFetch(`${this.baseUrl}/billing-quota/can-start-call`, {
      method: "POST",
      headers: internalApiHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ orgId }),
      timeoutMs: 1_500,
    });
    if (!res.ok) {
      throw new Error(`billing quota failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as BillingQuotaResponse;
  }
}
