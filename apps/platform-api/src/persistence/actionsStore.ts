import { createLogger } from "@rezovo/logging";
import { query } from "./dbClient";

const logger = createLogger({ service: "platform-api", module: "actionsStore" });

export async function getContacts(tenantId: string) {
  const result = await query(
    "SELECT * FROM contacts WHERE tenant_id = $1 ORDER BY last_contacted_at DESC NULLS LAST",
    [tenantId]
  );
  return result.rows.map(mapContactRow);
}

export async function getFollowUps(tenantId: string) {
  const result = await query(
    "SELECT * FROM follow_ups WHERE tenant_id = $1 ORDER BY priority, due_at",
    [tenantId]
  );
  return result.rows.map(mapFollowUpRow);
}

export async function getWorkflows(tenantId: string) {
  const result = await query(
    "SELECT * FROM workflows WHERE tenant_id = $1 ORDER BY created_at",
    [tenantId]
  );
  return result.rows.map(mapWorkflowRow);
}

export async function getTemplates(tenantId: string) {
  const result = await query(
    "SELECT * FROM templates WHERE tenant_id = $1 ORDER BY created_at",
    [tenantId]
  );
  return result.rows.map(mapTemplateRow);
}

function mapContactRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    tags: row.tags ?? [],
    smsOptOut: row.sms_opt_out ?? false,
    lastContactedAt: row.last_contacted_at,
  };
}

function mapFollowUpRow(row: any) {
  return {
    id: row.id,
    contactId: row.contact_id,
    callId: row.call_id,
    type: row.type,
    status: row.status,
    priority: row.priority,
    severity: row.severity,
    ownerId: row.owner_id,
    dueAt: row.due_at,
    createdAt: row.created_at,
    recommendedNextStep: row.recommended_next_step,
    channelPlan: row.channel_plan ?? {},
    attempts: row.attempts ?? [],
    scheduledSteps: row.scheduled_steps ?? [],
    metadata: row.metadata ?? {},
    vertical: row.vertical ?? "Common",
    notes: row.notes,
    tags: row.tags ?? [],
  };
}

function mapWorkflowRow(row: any) {
  return {
    id: row.id,
    vertical: row.vertical,
    name: row.name,
    enabled: row.enabled,
    triggerKey: row.trigger_key,
    conditions: row.conditions ?? {},
    steps: row.steps ?? [],
    attemptBudget: row.attempt_budget ?? {},
    escalationRules: row.escalation_rules ?? [],
    slaMinutes: row.sla_minutes,
    defaultOwnerStrategy: row.default_owner_strategy ?? "unassigned",
    isBuiltIn: row.is_built_in ?? false,
  };
}

function mapTemplateRow(row: any) {
  return {
    id: row.id,
    vertical: row.vertical,
    type: row.type,
    title: row.title,
    smsTemplate: row.sms_template,
    emailTemplate: row.email_template,
    quickReplies: row.quick_replies ?? [],
    tokens: row.tokens ?? [],
    checklist: row.checklist ?? [],
    defaultNextSteps: row.default_next_steps ?? [],
    links: row.links ?? {},
  };
}
