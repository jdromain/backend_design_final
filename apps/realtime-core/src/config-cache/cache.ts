import { AgentConfigSnapshot, PhoneNumberConfig, PlanSnapshot, RouteType } from "@rezovo/core-types";
import { ConfigSnapshotResponse } from "./fetcher";

type CacheState = {
  phoneNumbers: Map<string, PhoneNumberConfig>;
  agents: Map<string, AgentConfigSnapshot>;
  plans: Map<string, PlanSnapshot>;
};

function cacheKey(orgId: string, did: string, lob?: string): string {
  return `${orgId}::${lob ?? "default"}::${did}`;
}

export class ConfigCache {
  private state: CacheState = {
    phoneNumbers: new Map(),
    agents: new Map(),
    plans: new Map()
  };

  hydrate(snapshot: {
    phoneNumbers: PhoneNumberConfig[];
    agents: AgentConfigSnapshot[];
    plans: PlanSnapshot[];
    lob?: string;
  }): void {
    const lob = snapshot.lob;
    for (const pn of snapshot.phoneNumbers) {
      this.state.phoneNumbers.set(cacheKey(pn.orgId, pn.did, lob), pn);
    }
    for (const agent of snapshot.agents) {
      this.state.agents.set(agent.id, agent);
    }
    for (const plan of snapshot.plans) {
      this.state.plans.set(plan.orgId, plan);
    }
  }

  getRoute(did: string, orgId: string, lob?: string): PhoneNumberConfig | undefined {
    return this.state.phoneNumbers.get(cacheKey(orgId, did, lob));
  }

  getAgent(agentConfigId: string): AgentConfigSnapshot | undefined {
    return this.state.agents.get(agentConfigId);
  }

  getPlan(orgId: string): PlanSnapshot | undefined {
    return this.state.plans.get(orgId);
  }

  /** Replace only this org+lob in cache; do not evict other tenants' routes. */
  replaceFromSnapshot(snapshot: ConfigSnapshotResponse): void {
    const lob = snapshot.lob ?? "default";
    const orgPhonePrefix = `${snapshot.orgId}::${lob}::`;
    for (const key of [...this.state.phoneNumbers.keys()]) {
      if (key.startsWith(orgPhonePrefix)) {
        this.state.phoneNumbers.delete(key);
      }
    }
    for (const [id, agent] of [...this.state.agents.entries()]) {
      if (agent.orgId === snapshot.orgId) {
        this.state.agents.delete(id);
      }
    }
    this.state.plans.delete(snapshot.orgId);
    this.hydrate({
      phoneNumbers: snapshot.phoneNumbers,
      agents: [snapshot.agentConfig],
      plans: [snapshot.plan],
      lob: snapshot.lob
    });
  }
}

export function makeDefaultSnapshot(orgId: string, lob = "default", llmProfileId = ""): {
  phoneNumbers: PhoneNumberConfig[];
  agents: AgentConfigSnapshot[];
  plans: PlanSnapshot[];
  lob: string;
} {
  const defaultAgent: AgentConfigSnapshot = {
    id: "agent-default",
    version: 1,
    orgId,
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
    llmProfileId,
    toolAccess: ["book_appointment"],
    kbNamespace: "default-kb",
    maxCallDurationSec: 900,
    escalationRules: {
      escalateOnExplicitRequest: true,
      escalateOnPolicyHit: true,
      retryLimit: 2
    }
  };

  const defaultPlan: PlanSnapshot = {
    orgId,
    planId: "plan-default",
    maxConcurrentCalls: null
  };

  const defaultNumber: PhoneNumberConfig = {
    did: "+10000000000",
    orgId,
    businessId: "business-default",
    routeType: "ai" as RouteType,
    agentConfigId: defaultAgent.id
  };

  return {
    phoneNumbers: [defaultNumber],
    agents: [defaultAgent],
    plans: [defaultPlan],
    lob
  };
}
