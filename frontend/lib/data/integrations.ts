import { appendOrgQuery, del, get, post } from "@/lib/api-client"

export type IntegrationRecord = {
  id: string
  name: string
  description: string
  icon: string
  status: "connected" | "disconnected" | "degraded" | "error"
  requiredFields: { key: string; label: string; type: "text" | "password"; placeholder?: string }[]
}

export async function getIntegrations(): Promise<IntegrationRecord[]> {
  return get<IntegrationRecord[]>(appendOrgQuery("/integrations"))
}

export async function saveIntegrationConfig(provider: string, credentials: Record<string, string>) {
  return post<{ ok: boolean }>(appendOrgQuery(`/integrations/${encodeURIComponent(provider)}`), { credentials })
}

export async function testIntegration(provider: string) {
  return post<{ ok: boolean; valid: boolean; message: string }>(
    appendOrgQuery(`/integrations/${encodeURIComponent(provider)}/test`),
  )
}

export async function disconnectIntegration(provider: string) {
  return del<{ ok: boolean }>(appendOrgQuery(`/integrations/${encodeURIComponent(provider)}`))
}

export async function getIntegrationLogs(provider: string) {
  return get<Array<{ id: string; timestamp: string; action: string; status: "success" | "error" | "warning"; details?: string }>>(
    appendOrgQuery(`/integrations/${encodeURIComponent(provider)}/logs`),
  )
}

