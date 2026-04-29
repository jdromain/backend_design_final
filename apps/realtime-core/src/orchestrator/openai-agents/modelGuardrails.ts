import {
  Agent,
  run,
  type AgentInputItem,
  type ModelSettings,
  type NonStreamRunOptions,
  type RunResult,
  type StreamedRunResult,
  type StreamRunOptions,
} from "@openai/agents";
import { createLogger } from "@rezovo/logging";
import { env } from "../../env";

const logger = createLogger({ service: "realtime-core", module: "model-guardrails" });

const REASONING_MODEL_RE = /^(gpt-5|o1|o3|o4)/i;
const UNSUPPORTED_PARAM_RE = /Unsupported parameter:\s*'([^']+)'/i;

const MAX_HISTORY_ITEMS = Math.max(20, env.MODEL_GUARDRAILS_MAX_HISTORY_ITEMS);
const MAX_TOTAL_TEXT_CHARS = Math.max(5_000, env.MODEL_GUARDRAILS_MAX_TOTAL_TEXT_CHARS);
const MAX_ITEM_TEXT_CHARS = Math.max(400, env.MODEL_GUARDRAILS_MAX_ITEM_TEXT_CHARS);
const SLOW_RUN_LOG_THRESHOLD_MS = 1_200;
const warnedReasoningOnNanoModels = new Set<string>();

export type RunInputValidationIssue = {
  index: number;
  reason: string;
};

export type RunInputValidationResult = {
  isValid: boolean;
  history: AgentInputItem[];
  issues: RunInputValidationIssue[];
  truncated: boolean;
};

type GuardrailedRunMeta = {
  modelProfile: string;
  retryReason?: string;
  inputValidation: RunInputValidationResult;
  reasoningEnabled: boolean;
  reasoningEffort?: string;
  runDurationMs: number;
  runMode: "stream" | "non_stream";
  removedSettings: string[];
};

type GuardrailedNonStreamResult<TContext> = {
  result: RunResult<TContext, Agent<TContext, any>>;
} & GuardrailedRunMeta;

type GuardrailedStreamResult<TContext> = {
  result: StreamedRunResult<TContext, Agent<TContext, any>>;
} & GuardrailedRunMeta;

function cloneSettings(settings?: ModelSettings): ModelSettings {
  return {
    ...(settings ?? {}),
    reasoning: settings?.reasoning ? { ...settings.reasoning } : undefined,
    text: settings?.text ? { ...settings.text } : undefined,
    providerData: settings?.providerData ? { ...settings.providerData } : undefined,
  };
}

function extractReasoningEffort(settings?: ModelSettings): string | undefined {
  const reasoning = settings?.reasoning;
  if (!reasoning || typeof reasoning !== "object") return undefined;
  const effort = (reasoning as Record<string, unknown>).effort;
  return typeof effort === "string" && effort.length > 0 ? effort : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => isRecord(entry));
}

function asStatus(value: unknown): "in_progress" | "completed" | "incomplete" {
  return value === "in_progress" || value === "completed" || value === "incomplete"
    ? value
    : "completed";
}

function sanitizeProviderData(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function truncateTextWithBudget(
  text: string,
  budget: { remaining: number; truncated: boolean },
): string {
  let next = text;

  if (next.length > MAX_ITEM_TEXT_CHARS) {
    next = next.slice(0, MAX_ITEM_TEXT_CHARS);
    budget.truncated = true;
  }

  if (budget.remaining <= 0) {
    budget.truncated = true;
    return "";
  }

  if (next.length > budget.remaining) {
    next = next.slice(0, budget.remaining);
    budget.truncated = true;
  }

  budget.remaining -= next.length;
  return next;
}

function sanitizeMessageItem(
  item: Record<string, unknown>,
  budget: { remaining: number; truncated: boolean },
): AgentInputItem | null {
  const role = asString(item.role);
  if (!role) return null;

  if (role === "system") {
    const content = asString(item.content) ?? "";
    const text = truncateTextWithBudget(content, budget);
    if (!text) return null;

    return {
      role: "system",
      content: text,
      id: asString(item.id) ?? undefined,
      providerData: sanitizeProviderData(item.providerData),
    } as AgentInputItem;
  }

  if (role === "user") {
    const content = item.content;

    if (typeof content === "string") {
      const text = truncateTextWithBudget(content, budget);
      if (!text) return null;

      return {
        role: "user",
        content: [{ type: "input_text", text }],
        id: asString(item.id) ?? undefined,
        providerData: sanitizeProviderData(item.providerData),
      } as AgentInputItem;
    }

    const parts = asObjectArray(content)
      .map((part) => {
        const type = asString(part.type);
        if (!type) return null;

        if (type === "input_text") {
          const text = asString(part.text) ?? "";
          const truncated = truncateTextWithBudget(text, budget);
          if (!truncated) return null;
          return {
            type: "input_text" as const,
            text: truncated,
            providerData: sanitizeProviderData(part.providerData),
          };
        }

        if (type === "input_image") {
          if (typeof part.image === "string") {
            return {
              type: "input_image" as const,
              image: part.image,
              providerData: sanitizeProviderData(part.providerData),
            };
          }
          if (isRecord(part.image) && typeof part.image.id === "string") {
            return {
              type: "input_image" as const,
              image: { id: part.image.id },
              providerData: sanitizeProviderData(part.providerData),
            };
          }
          return null;
        }

        if (type === "input_file") {
          const file = part.file;
          if (typeof file === "string") {
            return {
              type: "input_file" as const,
              file,
              providerData: sanitizeProviderData(part.providerData),
            };
          }
          if (isRecord(file) && typeof file.id === "string") {
            return {
              type: "input_file" as const,
              file: { id: file.id },
              providerData: sanitizeProviderData(part.providerData),
            };
          }
          if (isRecord(file) && typeof file.url === "string") {
            return {
              type: "input_file" as const,
              file: { url: file.url },
              providerData: sanitizeProviderData(part.providerData),
            };
          }
          return null;
        }

        if (type === "audio") {
          const audio = part.audio;
          if (typeof audio !== "string" && !(isRecord(audio) && typeof audio.id === "string")) {
            return null;
          }
          return {
            type: "audio" as const,
            audio,
            format: asString(part.format) ?? undefined,
            transcript: asString(part.transcript)
              ? truncateTextWithBudget(asString(part.transcript) ?? "", budget)
              : undefined,
            providerData: sanitizeProviderData(part.providerData),
          };
        }

        return null;
      })
      .filter((part): part is NonNullable<typeof part> => part !== null);

    if (parts.length === 0) return null;

    return {
      role: "user",
      content: parts,
      id: asString(item.id) ?? undefined,
      providerData: sanitizeProviderData(item.providerData),
    } as AgentInputItem;
  }

  if (role === "assistant") {
    const parts = asObjectArray(item.content)
      .map((part) => {
        const type = asString(part.type);
        if (!type) return null;

        if (type === "output_text") {
          const text = truncateTextWithBudget(asString(part.text) ?? "", budget);
          if (!text) return null;
          return {
            type: "output_text" as const,
            text,
            providerData: sanitizeProviderData(part.providerData),
          };
        }

        if (type === "refusal") {
          const refusal = truncateTextWithBudget(asString(part.refusal) ?? "", budget);
          if (!refusal) return null;
          return {
            type: "refusal" as const,
            refusal,
            providerData: sanitizeProviderData(part.providerData),
          };
        }

        if (type === "audio") {
          const audio = part.audio;
          if (typeof audio !== "string" && !(isRecord(audio) && typeof audio.id === "string")) {
            return null;
          }
          return {
            type: "audio" as const,
            audio,
            format: asString(part.format) ?? undefined,
            transcript: asString(part.transcript)
              ? truncateTextWithBudget(asString(part.transcript) ?? "", budget)
              : undefined,
            providerData: sanitizeProviderData(part.providerData),
          };
        }

        if (type === "image") {
          const image = asString(part.image);
          if (!image) return null;
          return {
            type: "image" as const,
            image,
            providerData: sanitizeProviderData(part.providerData),
          };
        }

        return null;
      })
      .filter((part): part is NonNullable<typeof part> => part !== null);

    if (parts.length === 0) return null;

    return {
      role: "assistant",
      status: asStatus(item.status),
      content: parts,
      id: asString(item.id) ?? undefined,
      providerData: sanitizeProviderData(item.providerData),
    } as AgentInputItem;
  }

  return null;
}

function sanitizeToolOrReasoningItem(
  item: Record<string, unknown>,
  budget: { remaining: number; truncated: boolean },
): AgentInputItem | null {
  const type = asString(item.type);
  if (!type) return null;

  if (type === "function_call") {
    const name = asString(item.name);
    const callId = asString(item.callId);
    const args = asString(item.arguments) ?? "";
    if (!name || !callId) return null;

    return {
      type: "function_call",
      name,
      arguments: truncateTextWithBudget(args, budget),
      callId,
      status: asStatus(item.status),
      id: asString(item.id) ?? undefined,
      providerData: sanitizeProviderData(item.providerData),
    } as AgentInputItem;
  }

  if (type === "function_call_result") {
    const name = asString(item.name);
    const callId = asString(item.callId);
    if (!name || !callId || !isRecord(item.output)) return null;

    const outputType = asString(item.output.type);
    if (outputType === "text") {
      const text = truncateTextWithBudget(asString(item.output.text) ?? "", budget);
      if (!text) return null;
      return {
        type: "function_call_result",
        status: asStatus(item.status),
        name,
        callId,
        output: {
          type: "text",
          text,
          providerData: sanitizeProviderData(item.output.providerData),
        },
        id: asString(item.id) ?? undefined,
        providerData: sanitizeProviderData(item.providerData),
      } as AgentInputItem;
    }

    if (outputType === "image") {
      const data = asString(item.output.data);
      const mediaType = asString(item.output.mediaType);
      if (!data || !mediaType) return null;
      return {
        type: "function_call_result",
        status: asStatus(item.status),
        name,
        callId,
        output: {
          type: "image",
          data,
          mediaType,
          providerData: sanitizeProviderData(item.output.providerData),
        },
        id: asString(item.id) ?? undefined,
        providerData: sanitizeProviderData(item.providerData),
      } as AgentInputItem;
    }

    return null;
  }

  if (type === "hosted_tool_call") {
    const name = asString(item.name);
    if (!name) return null;
    return {
      type: "hosted_tool_call",
      name,
      status: asString(item.status) ?? undefined,
      arguments: asString(item.arguments)
        ? truncateTextWithBudget(asString(item.arguments) ?? "", budget)
        : undefined,
      output: asString(item.output)
        ? truncateTextWithBudget(asString(item.output) ?? "", budget)
        : undefined,
      id: asString(item.id) ?? undefined,
      providerData: sanitizeProviderData(item.providerData),
    } as AgentInputItem;
  }

  if (type === "computer_call") {
    const callId = asString(item.callId);
    const action = isRecord(item.action) ? item.action : null;
    if (!callId || !action) return null;
    return {
      type: "computer_call",
      status: asStatus(item.status),
      callId,
      action,
      id: asString(item.id) ?? undefined,
      providerData: sanitizeProviderData(item.providerData),
    } as AgentInputItem;
  }

  if (type === "computer_call_result") {
    const callId = asString(item.callId);
    const output = isRecord(item.output) ? item.output : null;
    if (!callId || !output || output.type !== "computer_screenshot" || typeof output.data !== "string") {
      return null;
    }

    return {
      type: "computer_call_result",
      callId,
      output: {
        type: "computer_screenshot",
        data: output.data,
        providerData: sanitizeProviderData(output.providerData),
      },
      id: asString(item.id) ?? undefined,
      providerData: sanitizeProviderData(item.providerData),
    } as AgentInputItem;
  }

  if (type === "reasoning") {
    const content = asObjectArray(item.content)
      .map((entry) => {
        if (entry.type !== "input_text") return null;
        const text = truncateTextWithBudget(asString(entry.text) ?? "", budget);
        if (!text) return null;
        return {
          type: "input_text" as const,
          text,
          providerData: sanitizeProviderData(entry.providerData),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (content.length === 0) return null;

    return {
      type: "reasoning",
      content,
      id: asString(item.id) ?? undefined,
      providerData: sanitizeProviderData(item.providerData),
      rawContent: asObjectArray(item.rawContent)
        .map((entry) => {
          if (entry.type !== "reasoning_text") return null;
          const text = truncateTextWithBudget(asString(entry.text) ?? "", budget);
          if (!text) return null;
          return {
            type: "reasoning_text" as const,
            text,
            providerData: sanitizeProviderData(entry.providerData),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    } as AgentInputItem;
  }

  if (type === "unknown") {
    return {
      type: "unknown",
      id: asString(item.id) ?? undefined,
      providerData: sanitizeProviderData(item.providerData),
    } as AgentInputItem;
  }

  return null;
}

export function validateRunInputHistory(history: AgentInputItem[]): RunInputValidationResult {
  const issues: RunInputValidationIssue[] = [];
  const budget = { remaining: MAX_TOTAL_TEXT_CHARS, truncated: false };

  const sanitized = history
    .map((item, index) => {
      if (!isRecord(item)) {
        issues.push({ index, reason: "history item must be an object" });
        return null;
      }

      const messageItem = sanitizeMessageItem(item, budget);
      if (messageItem) return messageItem;

      const toolItem = sanitizeToolOrReasoningItem(item, budget);
      if (toolItem) return toolItem;

      issues.push({ index, reason: "unsupported history item shape" });
      return null;
    })
    .filter((item): item is AgentInputItem => item !== null);

  if (sanitized.length > MAX_HISTORY_ITEMS) {
    const dropCount = sanitized.length - MAX_HISTORY_ITEMS;
    sanitized.splice(0, dropCount);
    issues.push({ index: 0, reason: `history trimmed by ${dropCount} items to enforce cap` });
    budget.truncated = true;
  }

  return {
    isValid: issues.length === 0,
    history: sanitized,
    issues,
    truncated: budget.truncated,
  };
}

function normalizeInputToHistory(input: string | AgentInputItem[]): RunInputValidationResult {
  if (typeof input === "string") {
    const budget = { remaining: MAX_TOTAL_TEXT_CHARS, truncated: false };
    const text = truncateTextWithBudget(input, budget);
    return {
      isValid: true,
      history: [
        {
          role: "user",
          content: [{ type: "input_text", text }],
        } as AgentInputItem,
      ],
      issues: [],
      truncated: budget.truncated,
    };
  }

  return validateRunInputHistory(input);
}

export async function runWithModelGuardrails<TContext>(opts: {
  agent: Agent<TContext, any>;
  input: string | AgentInputItem[];
  runOptions?: NonStreamRunOptions<TContext>;
  trustInputHistory?: boolean;
}): Promise<GuardrailedNonStreamResult<TContext>>;

export async function runWithModelGuardrails<TContext>(opts: {
  agent: Agent<TContext, any>;
  input: string | AgentInputItem[];
  runOptions: StreamRunOptions<TContext>;
  trustInputHistory?: boolean;
}): Promise<GuardrailedStreamResult<TContext>>;

export async function runWithModelGuardrails<TContext>(opts: {
  agent: Agent<TContext, any>;
  input: string | AgentInputItem[];
  runOptions?: NonStreamRunOptions<TContext> | StreamRunOptions<TContext>;
  /**
   * When true and `input` is already an AgentInputItem[] from SDK-managed history,
   * skip shape sanitization to avoid stripping required linked items (e.g. reasoning).
   */
  trustInputHistory?: boolean;
}): Promise<GuardrailedNonStreamResult<TContext> | GuardrailedStreamResult<TContext>> {
  const { agent, input, runOptions, trustInputHistory } = opts;

  const modelProfile = typeof agent.model === "string" ? agent.model : "custom-model";
  const runMode: "stream" | "non_stream" = runOptions?.stream ? "stream" : "non_stream";
  const inputValidation =
    trustInputHistory && Array.isArray(input)
      ? ({
          isValid: true,
          history: input,
          issues: [],
          truncated: false,
        } as RunInputValidationResult)
      : normalizeInputToHistory(input);
  if (inputValidation.history.length === 0) {
    throw new Error("Run input history is empty after validation");
  }

  if (inputValidation.issues.length > 0 || inputValidation.truncated) {
    logger.warn("run input history was sanitized", {
      agent: agent.name,
      issueCount: inputValidation.issues.length,
      truncated: inputValidation.truncated,
    });
  }

  const modelName = typeof agent.model === "string" ? agent.model : undefined;
  const baseSettings = cloneSettings(agent.modelSettings);
  const preSanitized = sanitizeModelSettingsForModel(modelName, baseSettings);
  const firstAgent =
    preSanitized.removed.length > 0 ? agent.clone({ modelSettings: preSanitized.sanitized }) : agent;
  const reasoningEnabled = preSanitized.sanitized.reasoning !== undefined;
  const reasoningEffort = extractReasoningEffort(preSanitized.sanitized);
  const runStartedAt = Date.now();

  if (reasoningEnabled && /nano/i.test(modelProfile) && !warnedReasoningOnNanoModels.has(modelProfile)) {
    warnedReasoningOnNanoModels.add(modelProfile);
    logger.warn("reasoning enabled on nano profile", {
      agent: agent.name,
      modelProfile,
      reasoningEffort: reasoningEffort ?? "default",
    });
  }

  const emitRunTimingLog = (params: {
    durationMs: number;
    retryReason?: string;
    removedSettings: string[];
    unsupportedParam?: string;
  }) => {
    if (
      params.durationMs < SLOW_RUN_LOG_THRESHOLD_MS &&
      !params.retryReason &&
      !params.unsupportedParam &&
      preSanitized.removed.length === 0 &&
      inputValidation.issues.length === 0 &&
      !inputValidation.truncated &&
      !reasoningEnabled
    ) {
      return;
    }

    logger.info("llm run latency", {
      agent: agent.name,
      modelProfile,
      runMode,
      runDurationMs: params.durationMs,
      retryReason: params.retryReason,
      unsupportedParam: params.unsupportedParam,
      removedSettings: params.removedSettings,
      inputIssueCount: inputValidation.issues.length,
      inputTruncated: inputValidation.truncated,
      reasoningEnabled,
      reasoningEffort,
    });
  };

  try {
    if (runOptions?.stream) {
      const streamed = await run(firstAgent, inputValidation.history, {
        ...runOptions,
        stream: true,
      });
      const runDurationMs = Date.now() - runStartedAt;
      const retryReason =
        preSanitized.removed.length > 0
          ? `pre_sanitized:${preSanitized.removed.join(",")}`
          : undefined;
      emitRunTimingLog({
        durationMs: runDurationMs,
        retryReason,
        removedSettings: preSanitized.removed,
      });
      return {
        result: streamed,
        modelProfile,
        retryReason,
        inputValidation,
        reasoningEnabled,
        reasoningEffort,
        runDurationMs,
        runMode,
        removedSettings: preSanitized.removed,
      };
    }

    const nonStreamed = await run(firstAgent, inputValidation.history, runOptions);
    const runDurationMs = Date.now() - runStartedAt;
    const retryReason =
      preSanitized.removed.length > 0 ? `pre_sanitized:${preSanitized.removed.join(",")}` : undefined;
    emitRunTimingLog({
      durationMs: runDurationMs,
      retryReason,
      removedSettings: preSanitized.removed,
    });
    return {
      result: nonStreamed,
      modelProfile,
      retryReason,
      inputValidation,
      reasoningEnabled,
      reasoningEffort,
      runDurationMs,
      runMode,
      removedSettings: preSanitized.removed,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const unsupportedParam = extractUnsupportedParam(msg);
    if (!unsupportedParam) {
      const runDurationMs = Date.now() - runStartedAt;
      logger.warn("llm run failed", {
        agent: agent.name,
        modelProfile,
        runMode,
        runDurationMs,
        error: msg,
        reasoningEnabled,
        reasoningEffort,
      });
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

    if (runOptions?.stream) {
      const streamed = await run(retryAgent, inputValidation.history, {
        ...runOptions,
        stream: true,
      });
      const runDurationMs = Date.now() - runStartedAt;
      const retryReason = `unsupported_param:${unsupportedParam}`;
      emitRunTimingLog({
        durationMs: runDurationMs,
        retryReason,
        removedSettings: [...preSanitized.removed, ...stripped.removed],
        unsupportedParam,
      });
      return {
        result: streamed,
        modelProfile,
        retryReason,
        inputValidation,
        reasoningEnabled,
        reasoningEffort,
        runDurationMs,
        runMode,
        removedSettings: [...preSanitized.removed, ...stripped.removed],
      };
    }

    const nonStreamed = await run(retryAgent, inputValidation.history, runOptions);
    const runDurationMs = Date.now() - runStartedAt;
    const retryReason = `unsupported_param:${unsupportedParam}`;
    emitRunTimingLog({
      durationMs: runDurationMs,
      retryReason,
      removedSettings: [...preSanitized.removed, ...stripped.removed],
      unsupportedParam,
    });
    return {
      result: nonStreamed,
      modelProfile,
      retryReason,
      inputValidation,
      reasoningEnabled,
      reasoningEffort,
      runDurationMs,
      runMode,
      removedSettings: [...preSanitized.removed, ...stripped.removed],
    };
  }
}

export async function runStreamWithModelGuardrails<TContext>(opts: {
  agent: Agent<TContext, any>;
  input: string | AgentInputItem[];
  runOptions: Omit<StreamRunOptions<TContext>, "stream">;
  trustInputHistory?: boolean;
}): Promise<GuardrailedStreamResult<TContext>> {
  return runWithModelGuardrails<TContext>({
    agent: opts.agent,
    input: opts.input,
    runOptions: {
      ...opts.runOptions,
      stream: true,
    } as StreamRunOptions<TContext>,
    trustInputHistory: opts.trustInputHistory,
  }) as Promise<GuardrailedStreamResult<TContext>>;
}

export const RUN_INPUT_LIMITS = {
  MAX_HISTORY_ITEMS,
  MAX_TOTAL_TEXT_CHARS,
  MAX_ITEM_TEXT_CHARS,
} as const;
