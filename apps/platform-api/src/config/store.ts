import { AgentConfigSnapshot, PhoneNumberConfig, PlanSnapshot } from "@rezovo/core-types";
import { createLogger } from "@rezovo/logging";

import { createDefaultTenantConfig } from "./data";
import { PersistenceStore } from "../persistence/store";
import { callStore } from "../persistence/callStore";

const logger = createLogger({ service: "platform-api", module: "configStore" });

type TenantLobKey = string;

type StoredConfig = {
  version: number;
  status: "draft" | "published";
  agentConfig: AgentConfigSnapshot;
  phoneNumbers: PhoneNumberConfig[];
  plan: PlanSnapshot;
  lob: string;
};

function key(tenantId: string, lob?: string): TenantLobKey {
  return `${tenantId}::${lob ?? "default"}`;
}

export class ConfigStore {
  private store = new Map<TenantLobKey, StoredConfig>();
  private persistence: PersistenceStore;

  constructor(persistence = new PersistenceStore()) {
    this.persistence = persistence;
  }

  ensure(tenantId: string, lob = "default"): StoredConfig {
    const k = key(tenantId, lob);
    const existing = this.store.get(k);
    if (existing) return existing;
    // Attempt load from persistence
    return this.loadOrInit(tenantId, lob);
  }

  private loadOrInit(tenantId: string, lob: string): StoredConfig {
    const k = key(tenantId, lob);
    const persisted = this.persistence.loadConfigSync(tenantId, lob);
    if (persisted) {
      this.store.set(k, persisted);
      return persisted;
    }
    const snapshot = createDefaultTenantConfig(tenantId, lob);
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

  async getSnapshot(tenantId: string, lob = "default") {
    const cfg = this.ensure(tenantId, lob);

    // Load actual phone numbers from the phone_numbers table (via callStore)
    let phoneNumbers = cfg.phoneNumbers;
    try {
      const dbNumbers = await callStore.getPhoneNumbersByTenant(tenantId);
      if (dbNumbers.length > 0) {
        phoneNumbers = dbNumbers
          .filter(pn => pn.status === "active")
          .map(pn => ({
            did: pn.phoneNumber,
            tenantId: pn.tenantId,
            businessId: `business-${pn.tenantId}`, // TODO: Map to actual business
            routeType: (pn.routeType === "human" ? "queue" : pn.routeType ?? "ai") as "ai" | "queue" | "voicemail",
            agentConfigId: pn.agentConfigId ?? cfg.agentConfig.id,
          }));
        logger.info("loaded phone numbers from DB", {
          tenantId,
          count: phoneNumbers.length,
          numbers: phoneNumbers.map(p => p.did)
        });
      } else {
        logger.warn("no phone numbers found in DB, using defaults", { tenantId });
      }
    } catch (err) {
      logger.error("failed to load phone numbers from DB", {
        error: (err as Error).message,
        tenantId
      });
      // Fall back to configured phone numbers
    }

    return {
      tenantId,
      lob,
      version: cfg.version,
      status: cfg.status,
      agentConfig: cfg.agentConfig,
      phoneNumbers,
      plan: cfg.plan
    };
  }

  publishConfig(params: {
    tenantId: string;
    lob?: string;
    version: number;
    status: "draft" | "published";
  }): StoredConfig {
    const cfg = this.ensure(params.tenantId, params.lob);
    cfg.version = params.version;
    cfg.status = params.status;
    this.persistence.saveConfig(params.tenantId, params.lob ?? "default", cfg).catch(() => undefined);
    return cfg;
  }

  upsertConfig(params: {
    tenantId: string;
    lob?: string;
    agentConfig: AgentConfigSnapshot;
    phoneNumbers: PhoneNumberConfig[];
    plan: PlanSnapshot;
    status: "draft" | "published";
  }): StoredConfig {
    const k = key(params.tenantId, params.lob);
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
    this.persistence.saveConfig(params.tenantId, params.lob ?? "default", stored).catch(() => undefined);
    return stored;
  }
}
