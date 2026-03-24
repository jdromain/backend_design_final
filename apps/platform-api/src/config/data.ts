import { randomUUID } from "crypto";

import {
  AgentConfigSnapshot,
  PlanSnapshot,
  PhoneNumberConfig,
  RouteType,
  TypedEventEnvelope
} from "@rezovo/core-types";

type ConfigSnapshot = {
  tenantId: string;
  lob: string;
  version: number;
  status: "draft" | "published";
  agentConfig: AgentConfigSnapshot;
  phoneNumbers: PhoneNumberConfig[];
  plan: PlanSnapshot;
};

const schemaByLob: Record<string, unknown> = {
  default: {
    version: "1.0",
    fields: [
      { key: "businessName", label: "Business Name", type: "string", required: true },
      { key: "persona", label: "Persona", type: "enum", options: ["receptionist", "scheduler", "support"] },
      { key: "openingHours", label: "Opening Hours", type: "opening_hours" },
      { key: "routeType", label: "Route Type", type: "enum", options: ["ai", "queue", "voicemail"] },
      { key: "toolAccess", label: "Tools", type: "multiselect", options: ["book_appointment", "send_sms"] },
      { key: "languagePrefs", label: "Languages", type: "multiselect", options: ["en", "es", "fr"] }
    ]
  }
};

const templatesByLob: Record<string, Array<Record<string, unknown>>> = {
  default: [
    {
      id: "base-reception",
      name: "Base Receptionist",
      version: 1,
      description: "Greets callers, collects reason, books or takes a message.",
      config: {
        persona: "receptionist",
        toolAccess: ["book_appointment", "send_sms"],
        languagePrefs: ["en"],
        routeType: "ai"
      }
    }
  ]
};

const defaultAgentConfig: AgentConfigSnapshot = {
  id: "agent-default",
  version: 1,
  tenantId: "tenant-default",
  businessId: "business-default",
  basePrompt: "You are a helpful receptionist. Be concise and polite.",
  persona: "receptionist",
  openingHours: {
    monday: [{ open: "09:00", close: "17:00" }],
    tuesday: [{ open: "09:00", close: "17:00" }],
    wednesday: [{ open: "09:00", close: "17:00" }],
    thursday: [{ open: "09:00", close: "17:00" }],
    friday: [{ open: "09:00", close: "17:00" }]
  },
  languagePrefs: ["en"],
  llmProfileId: "gpt-4o-mini",
  toolAccess: ["book_appointment", "send_sms"],
  kbNamespace: "general",
  maxCallDurationSec: 900,
  escalationRules: {
    escalateOnExplicitRequest: true,
    escalateOnPolicyHit: true,
    retryLimit: 2
  },
  bookingProvider: process.env.CALENDLY_ACCESS_TOKEN ? "calendly" : "none",
  calendly: process.env.CALENDLY_ACCESS_TOKEN ? {
    accessToken: process.env.CALENDLY_ACCESS_TOKEN,
    eventTypeUri: process.env.CALENDLY_EVENT_TYPE_URI || "",
    timezone: process.env.CALENDLY_TIMEZONE || "America/New_York",
  } : undefined,
};

const defaultPhoneNumber: PhoneNumberConfig = {
  did: "+10000000000",
  tenantId: "tenant-default",
  businessId: "business-default",
  routeType: "ai",
  agentConfigId: defaultAgentConfig.id
};

const defaultPlan: PlanSnapshot = {
  tenantId: "tenant-default",
  planId: "plan-default",
  maxConcurrentCalls: null
};

export function getSchema(lob?: string): unknown {
  return schemaByLob[lob ?? ""] ?? schemaByLob.default;
}

export function getTemplates(lob?: string): Array<Record<string, unknown>> {
  return templatesByLob[lob ?? ""] ?? templatesByLob.default;
}

export function getSnapshot(tenantId: string, lob = "default"): ConfigSnapshot {
  return {
    tenantId,
    lob,
    version: 1,
    status: "published",
    agentConfig: { ...defaultAgentConfig, tenantId },
    phoneNumbers: [{ ...defaultPhoneNumber, tenantId }],
    plan: { ...defaultPlan, tenantId }
  };
}

type ValidateRequest = {
  lob?: string;
  config: {
    agentConfig: AgentConfigSnapshot;
    phoneNumbers: PhoneNumberConfig[];
    plan: PlanSnapshot;
  };
};

export type ValidateResult = {
  ok: boolean;
  warnings: string[];
  errors: string[];
  normalizedConfig?: ValidateRequest["config"];
};

function validateRouteType(routeType: RouteType): boolean {
  return routeType === "ai" || routeType === "queue" || routeType === "voicemail";
}

export function validateConfig(input: ValidateRequest): ValidateResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const { config } = input;
  if (!config?.agentConfig) {
    errors.push("agentConfig is required");
  }
  if (!config?.phoneNumbers?.length) {
    errors.push("at least one phone number is required");
  }
  if (!config?.plan) {
    errors.push("plan is required");
  }

  const normalized = { ...config };

  if (config?.phoneNumbers) {
    for (const pn of config.phoneNumbers) {
      if (!validateRouteType(pn.routeType)) {
        errors.push(`invalid routeType for DID ${pn.did}`);
      }
    }
  }

  if (config?.agentConfig?.toolAccess?.length && config.plan.planId === "plan-default") {
    // Example gating: default plan only allows book_appointment
    const disallowed = config.agentConfig.toolAccess.filter((t) => t !== "book_appointment");
    if (disallowed.length > 0) {
      warnings.push(`tools not allowed on current plan: ${disallowed.join(", ")}`);
    }
  }

  return {
    ok: errors.length === 0,
    warnings,
    errors,
    normalizedConfig: errors.length === 0 ? normalized : undefined
  };
}

export function buildConfigChangedEvent(payload: {
  tenantId: string;
  lob?: string;
  version: number;
  entity: "PhoneNumber" | "AgentConfig" | "Plan" | "Business";
  entity_id: string;
  status: "draft" | "published";
}): TypedEventEnvelope<"ConfigChanged"> {
  return {
    event_id: randomUUID(),
    event_type: "ConfigChanged",
    tenant_id: payload.tenantId,
    call_id: undefined,
    timestamp: new Date().toISOString(),
    payload: {
      entity: payload.entity,
      entity_id: payload.entity_id,
      version: payload.version,
      lob: payload.lob,
      status: payload.status
    }
  };
}

export function createDefaultTenantConfig(tenantId: string, lob = "default"): ConfigSnapshot {
  return getSnapshot(tenantId, lob);
}

