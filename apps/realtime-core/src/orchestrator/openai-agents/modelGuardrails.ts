import { Agent, run, type AgentInputItem, type ModelSettings } from "@openai/agents";
import { createLogger } from "@rezovo/logging";

const logger = createLogger({ service: "realtime-core", module: "model-guardrails" });

const REASONING_MODEL_RE = /^(gpt-5|o1|o3|o4)/i;
const UNSUPPORTED_PARAM_RE = /Unsupported parameter:\s*'([^']+)'/i;

function cloneSettings(settings?: ModelSettings): ModelSettings {
  return {
    ...(settings ?? {}),
    reasoning: settings?.reasoning ? { ...settings.reasoning } : undefined,
    text: settings?.text ? { ...settings.text } : undefined,
    providerData: settings?.providerData ? { ...settings.providerData } : undefined,
  };
}

export function sanitizeModelSettingsForModel(
  modelName: string | undefined,
  settings?: ModelSettings,
): { sanitized: ModelSettings; removed: string[] } {
  const sanitized = cloneSettings(settings);
  const removed: string[] = [];
  const model = modelName ?? "";
  const reasoningModel = REASONING_MODEL_RE.test(model);

  if (!reasoningModel && sanitized.reasoning !== undefined) {
    delete sanitized.reasoning;
    removed.push("reasoning");
  }

  if (reasoningModel) {
    if (sanitized.temperature !== undefined) {
      delete sanitized.temperature;
      removed.push("temperature");
    }
    if (sanitized.topP !== undefined) {
      delete sanitized.topP;
      removed.push("topP");
    }
    if (sanitized.frequencyPenalty !== undefined) {
      delete sanitized.frequencyPenalty;
      removed.push("frequencyPenalty");
    }
    if (sanitized.presencePenalty !== undefined) {
      delete sanitized.presencePenalty;
      removed.push("presencePenalty");
    }
  }

  return { sanitized, removed };
}

export function resolveModelSettingsForModel(modelName: string | undefined, settings?: ModelSettings): ModelSettings {
  return sanitizeModelSettingsForModel(modelName, settings).sanitized;
}

function extractUnsupportedParam(errorMessage: string): string | null {
  const match = errorMessage.match(UNSUPPORTED_PARAM_RE);
  return match ? match[1] : null;
}

export function stripUnsupportedParameterFromSettings(
  settings: ModelSettings,
  unsupportedParam: string,
): { sanitized: ModelSettings; removed: string[] } {
  const sanitized = cloneSettings(settings);
  const removed: string[] = [];
  const p = unsupportedParam.toLowerCase();

  const remove = (label: string, cb: () => void) => {
    cb();
    removed.push(label);
  };

  if (p.includes("reasoning")) {
    if (sanitized.reasoning !== undefined) {
      remove("reasoning", () => {
        delete sanitized.reasoning;
      });
    }
  } else if (p === "temperature") {
    if (sanitized.temperature !== undefined) {
      remove("temperature", () => {
        delete sanitized.temperature;
      });
    }
  } else if (p === "top_p" || p === "topp") {
    if (sanitized.topP !== undefined) {
      remove("topP", () => {
        delete sanitized.topP;
      });
    }
  } else if (p === "frequency_penalty" || p === "frequencypenalty") {
    if (sanitized.frequencyPenalty !== undefined) {
      remove("frequencyPenalty", () => {
        delete sanitized.frequencyPenalty;
      });
    }
  } else if (p === "presence_penalty" || p === "presencepenalty") {
    if (sanitized.presencePenalty !== undefined) {
      remove("presencePenalty", () => {
        delete sanitized.presencePenalty;
      });
    }
  } else if (p === "max_output_tokens" || p === "maxtokens" || p === "max_tokens") {
    if (sanitized.maxTokens !== undefined) {
      remove("maxTokens", () => {
        delete sanitized.maxTokens;
      });
    }
  }

  return { sanitized, removed };
}

function shallowEqualSettings(a: ModelSettings, b: ModelSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function runWithModelGuardrails(opts: {
  agent: Agent<any, any>;
  input: string | AgentInputItem[];
  runOptions?: Record<string, unknown>;
}): Promise<{
  result: unknown;
  modelProfile: string;
  retryReason?: string;
}> {
  const { agent, input, runOptions } = opts;
  const modelProfile = typeof agent.model === "string" ? agent.model : "custom-model";
  const baseSettings = cloneSettings(agent.modelSettings);
  const preSanitized = sanitizeModelSettingsForModel(
    typeof agent.model === "string" ? agent.model : undefined,
    baseSettings,
  );
  const firstAgent =
    preSanitized.removed.length > 0 ? agent.clone({ modelSettings: preSanitized.sanitized }) : agent;

  try {
    const result = await run(firstAgent as any, input as any, runOptions as any);
    return {
      result,
      modelProfile,
      retryReason: preSanitized.removed.length > 0 ? `pre_sanitized:${preSanitized.removed.join(",")}` : undefined,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const unsupportedParam = extractUnsupportedParam(msg);
    if (!unsupportedParam) {
      throw error;
    }

    const stripped = stripUnsupportedParameterFromSettings(firstAgent.modelSettings ?? {}, unsupportedParam);
    if (stripped.removed.length === 0 || shallowEqualSettings(firstAgent.modelSettings ?? {}, stripped.sanitized)) {
      throw error;
    }

    const retryAgent = firstAgent.clone({ modelSettings: stripped.sanitized });
    logger.warn("retrying run after unsupported parameter", {
      agent: agent.name,
      modelProfile,
      unsupportedParam,
      removed: stripped.removed,
    });
    const retryResult = await run(retryAgent as any, input as any, runOptions as any);
    return {
      result: retryResult,
      modelProfile,
      retryReason: `unsupported_param:${unsupportedParam}`,
    };
  }
}
