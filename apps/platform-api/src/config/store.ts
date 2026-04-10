import { AgentConfigSnapshot, PhoneNumberConfig, PlanSnapshot } from "@rezovo/core-types";
import { createLogger } from "@rezovo/logging";

import { createDefaultOrganizationConfig } from "./data";
import { PersistenceStore } from "../persistence/store";
import { callStore } from "../persistence/callStore";
import { query } from "../persistence/dbClient";

const logger = createLogger({ service: "platform-api", module: "configStore" });

type OrganizationLobKey = string;

type StoredConfig = {
  version: number;
  status: "draft" | "published";
  agentConfig: AgentConfigSnapshot;
  phoneNumbers: PhoneNumberConfig[];
  plan: PlanSnapshot;
  lob: string;
};

function key(orgId: string, lob?: string): OrganizationLobKey {
  return `${orgId}::${lob ?? "default"}`;
}

async function resolveOrganizationBusinessId(orgId: string): Promise<string> {
  try {
    const result = await query<{ business_id: string | null }>(
      "SELECT business_id FROM organizations WHERE id = $1 LIMIT 1",
      [orgId]
    );
    const value = result.rows[0]?.business_id;
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  } catch (err) {
    logger.warn("failed to resolve organization business_id", {
      orgId,
      error: (err as Error).message,
    });
  }
  return `business-${orgId}`;
}

export class ConfigStore {
  private store = new Map<OrganizationLobKey, StoredConfig>();
  private persistence: PersistenceStore;

  constructor(persistence = new PersistenceStore()) {
    this.persistence = persistence;
  }

  ensure(orgId: string, lob = "default"): StoredConfig {
    const k = key(orgId, lob);
    const existing = this.store.get(k);
    if (existing) return existing;
    // Attempt load from persistence
    return this.loadOrInit(orgId, lob);
  }

  private loadOrInit(orgId: string, lob: string): StoredConfig {
    const k = key(orgId, lob);
    const persisted = this.persistence.loadConfigSync(orgId, lob);
    if (persisted) {
      this.store.set(k, persisted);
      return persisted;
    }
    const snapshot = createDefaultOrganizationConfig(orgId, lob);
    const stored: StoredConfig = {
      version: snapshot.version,
      status: snapshot.status,
      agentConfig: snapshot.agentConfig,
      phoneNumbers: snapshot.phoneNumbers,
      plan: snapshot.plan,
      lob
    };
    this.store.set(k, stored);
    return stored;
  }

  async getSnapshot(orgId: string, lob = "default") {
    const cfg = this.ensure(orgId, lob);
    const organizationBusinessId = await resolveOrganizationBusinessId(orgId);

    // Load actual phone numbers from the phone_numbers table (via callStore)
    let phoneNumbers = cfg.phoneNumbers;
    try {
      const dbNumbers = await callStore.getPhoneNumbersByOrganization(orgId);
      if (dbNumbers.length > 0) {
        phoneNumbers = dbNumbers
          .filter(pn => pn.status === "active")
          .map(pn => ({
            did: pn.phoneNumber,
            orgId: pn.orgId,
            businessId: organizationBusinessId,
            routeType: (pn.routeType === "human" ? "queue" : pn.routeType ?? "ai") as "ai" | "queue" | "voicemail",
            agentConfigId: pn.agentConfigId ?? cfg.agentConfig.id,
          }));
        logger.info("loaded phone numbers from DB", {
          orgId,
          count: phoneNumbers.length,
          numbers: phoneNumbers.map(p => p.did)
        });
      } else {
        logger.warn("no phone numbers found in DB, using defaults", { orgId });
      }
    } catch (err) {
      logger.error("failed to load phone numbers from DB", {
        error: (err as Error).message,
        orgId
      });
      // Fall back to configured phone numbers
    }

    const normalizedPhoneNumbers = phoneNumbers.map((pn) => ({
      ...pn,
      businessId: !pn.businessId || pn.businessId === "business-default" ? organizationBusinessId : pn.businessId,
    }));
    const normalizedAgentConfig = {
      ...cfg.agentConfig,
      orgId,
      businessId:
        !cfg.agentConfig.businessId || cfg.agentConfig.businessId === "business-default"
          ? organizationBusinessId
          : cfg.agentConfig.businessId,
    };

    return {
      orgId,
      lob,
      version: cfg.version,
      status: cfg.status,
      agentConfig: normalizedAgentConfig,
      phoneNumbers: normalizedPhoneNumbers,
      plan: cfg.plan
    };
  }

  publishConfig(params: {
    orgId: string;
    lob?: string;
    version: number;
    status: "draft" | "published";
  }): StoredConfig {
    const cfg = this.ensure(params.orgId, params.lob);
    cfg.version = params.version;
    cfg.status = params.status;
    this.persistence.saveConfig(params.orgId, params.lob ?? "default", cfg).catch(() => undefined);
    return cfg;
  }

  upsertConfig(params: {
    orgId: string;
    lob?: string;
    agentConfig: AgentConfigSnapshot;
    phoneNumbers: PhoneNumberConfig[];
    plan: PlanSnapshot;
    status: "draft" | "published";
  }): StoredConfig {
    const k = key(params.orgId, params.lob);
    const nextVersion = (this.store.get(k)?.version ?? 0) + 1;
    const stored: StoredConfig = {
      version: nextVersion,
      status: params.status,
      agentConfig: params.agentConfig,
      phoneNumbers: params.phoneNumbers,
      plan: params.plan,
      lob: params.lob ?? "default"
    };
    this.store.set(k, stored);
    this.persistence.saveConfig(params.orgId, params.lob ?? "default", stored).catch(() => undefined);
    return stored;
  }
}
