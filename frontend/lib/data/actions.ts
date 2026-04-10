import { assertMockSafety } from "./_env-check"
import {
  generateContacts,
  generateCalls,
  generateFollowUps,
  generateWorkflows,
  generateTemplates,
} from "@/data/mock/actions"
import type { Contact, Call, FollowUp, Workflow, Template } from "@/types/api"
import { appendOrgQuery, get } from "@/lib/api-client"

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export async function getContacts(): Promise<Contact[]> {
  if (useMocks) return generateContacts()
  return get<Contact[]>(appendOrgQuery("/contacts"))
}

export async function getCalls(): Promise<Call[]> {
  if (useMocks) return generateCalls()
  return get<Call[]>(appendOrgQuery("/actions/calls"))
}

export async function getFollowUps(): Promise<FollowUp[]> {
  if (useMocks) return generateFollowUps()
  return get<FollowUp[]>(appendOrgQuery("/follow-ups"))
}

export async function getWorkflows(): Promise<Workflow[]> {
  if (useMocks) return generateWorkflows()
  return get<Workflow[]>(appendOrgQuery("/workflows"))
}

export async function getTemplates(): Promise<Template[]> {
  if (useMocks) return generateTemplates()
  return get<Template[]>(appendOrgQuery("/templates"))
}
