/**
 * OpenAI Agents SDK Workflow -- Minimal orchestrator following SDK patterns.
 *
 * References:
 *   https://github.com/openai/openai-agents-js/blob/main/examples/agent-patterns/routing.ts
 *   https://github.com/openai/openai-agents-js/blob/main/examples/customer-service
 *
 * Core loop per the SDK examples:
 *   1. history.push({ role: "user", content: utterance })
 *   2. stream = await run(currentAgent, history, { stream: true, context })
 *   3. for await (chunk of stream.toTextStream()) -> sentence buffer -> TTS
 *   4. await stream.completed
 *   5. history = stream.history        (SDK manages full history including tool calls)
 *   6. currentAgent = stream.currentAgent ?? currentAgent   (SDK manages handoffs)
 */

import { randomUUID } from "crypto";
import { run } from "@openai/agents";
import type { Agent, AgentInputItem, StreamedRunResult } from "@openai/agents";
import { createLogger } from "@rezovo/logging";
import { triageAgent, type CallContext } from "./agents";
import { GuardrailsEngine } from "./guardrails";
import { retrieveKb } from "../../kbClient";
import { env } from "../../env";
import type { AgentConfigSnapshot, PhoneNumberConfig } from "@rezovo/core-types";
import { traceLog, summarizeHistoryForTrace } from "../../traceLog";

const logger = createLogger({ service: "realtime-core", module: "openai-agents" });

// ---- Public types ----

export type OnSentenceCallback = (sentence: string) => void | Promise<void>;

export interface TurnResult {
  turnId: string;
  action: "speak" | "transfer" | "end";
  text: string;
  agentName: string;
  history: AgentInputItem[];
  currentAgent: Agent<any, any>;
}

// ---- Sentence buffer for streaming LLM tokens into speakable chunks ----

class SentenceBuffer {
  private buffer = "";

  push(delta: string): string[] {
    this.buffer += delta;
    const emitted: string[] = [];
    let pos = 0;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      const ch = this.buffer[i];
      const next = this.buffer[i + 1];
      if ((ch === "." || ch === "!" || ch === "?") && (next === " " || next === "\n")) {
        const sentence = this.buffer.slice(pos, i + 1).trim();
        if (sentence.length > 0) emitted.push(sentence);
        pos = i + 2;
      }
    }

    if (this.buffer.length > 80 && emitted.length === 0) {
      for (let i = this.buffer.length - 2; i >= 20; i--) {
        if (this.buffer[i] === "," && this.buffer[i + 1] === " ") {
          const chunk = this.buffer.slice(pos, i + 1).trim();
          if (chunk.length > 0) emitted.push(chunk);
          pos = i + 2;
          break;
        }
      }
    }

    this.buffer = this.buffer.slice(pos);
    return emitted;
  }

  flush(): string | null {
    const remaining = this.buffer.trim();
    this.buffer = "";
    return remaining.length > 0 ? remaining : null;
  }
}

// ---- Action detection from agent text ----

function detectActionFromText(text: string): "speak" | "transfer" | "end" {
  const lower = text.toLowerCase();
  // Only detect transfer when the agent explicitly says it's connecting to a HUMAN/person/manager.
  // Do NOT match "connect you with our Booking Specialist" -- that's an internal agent handoff.
  if (/\b(transfer you to a|connect you with a|putting you through to a)\s*(real|live|human)?\s*(person|human|agent|representative|manager|someone)\b/.test(lower)) {
    return "transfer";
  }
  if (/\b(goodbye|good bye|have a (great|good|wonderful) (day|evening|night)|thanks? for calling|take care)\b/.test(lower)) {
    return "end";
  }
  return "speak";
}

// ---- Guardrails (reuse existing engine) ----

const guardrails = new GuardrailsEngine();

// ---- History utilities ----

/**
 * Cap history at maxPairs exchange pairs to prevent context window overflow.
 * Always preserves the first item (greeting seed).
 */
function trimHistory(h: AgentInputItem[], maxPairs = 20): AgentInputItem[] {
  const seed = h.slice(0, 1);
  const rest = h.slice(1);
  const maxItems = maxPairs * 2;
  return rest.length > maxItems ? [...seed, ...rest.slice(-maxItems)] : h;
}

// ---- Build CallContext from agent config ----

export function buildCallContext(
  callId: string,
  agentConfig: AgentConfigSnapshot,
  _phoneConfig: PhoneNumberConfig,
  kbPassages: string[],
  currentDateTime: string,
): CallContext {
  return {
    tenantId: agentConfig.tenantId,
    businessId: agentConfig.businessId,
    callId,
    currentDateTime,
    calendlyAccessToken: agentConfig.calendly?.accessToken,
    calendlyEventTypeUri: agentConfig.calendly?.eventTypeUri,
    calendlyTimezone: agentConfig.calendly?.timezone,
    restaurantId: agentConfig.opentable?.restaurantId,
    kbPassages,
    openingHours: agentConfig.openingHours
      ? Object.entries(agentConfig.openingHours)
          .filter(([, slots]) => Array.isArray(slots) && slots.length > 0)
          .map(
            ([day, slots]) =>
              `${day}: ${(slots as any[]).map((s: any) => `${s.open}-${s.close}`).join(", ")}`,
          )
          .join("; ")
      : undefined,
  };
}

// ---- KB retrieval helper ----

async function fetchKbPassages(
  callId: string,
  query: string,
  tenantId: string,
  businessId: string,
  namespace: string,
): Promise<string[]> {
  try {
    const result = await retrieveKb({
      tenant_id: tenantId,
      business_id: businessId,
      namespace,
      query,
      topK: 3,
    });
    if (result.passages.length > 0) {
      logger.debug("KB passages fetched", { callId, matchCount: result.passages.length });
      return result.passages.map((p) => p.text);
    }
  } catch (err) {
    logger.warn("KB fetch failed (non-fatal)", { callId, error: (err as Error).message });
  }
  return [];
}

// ---- Main turn processor ----

export async function processTurn(opts: {
  utterance: string;
  callId: string;
  history: AgentInputItem[];
  currentAgent: Agent<any, any>;
  agentConfig: AgentConfigSnapshot;
  phoneConfig: PhoneNumberConfig;
  onSentence: OnSentenceCallback;
  currentDateTime?: string;
  signal?: AbortSignal;
}): Promise<TurnResult> {
  const {
    utterance,
    callId,
    history: historyIn,
    currentAgent,
    agentConfig,
    phoneConfig,
    onSentence,
    currentDateTime,
    signal,
  } = opts;
  let history = historyIn;
  const turnStart = Date.now();
  const turnId = randomUUID();
  const isDev = env.NODE_ENV === "development";

  traceLog.turnStart(callId, turnId, utterance, { agentName: currentAgent.name, historyLen: history.length });

  // 1. Input guardrails + KB fetch in parallel (skip guardrails in dev for speed)
  const [inputCheckResult, kbPassages] = await Promise.all([
    isDev
      ? Promise.resolve(null)
      : guardrails.checkInput(utterance, callId),
    agentConfig.kbNamespace
      ? fetchKbPassages(callId, utterance, agentConfig.tenantId, agentConfig.businessId, agentConfig.kbNamespace)
      : Promise.resolve([] as string[]),
  ]);

  traceLog.guardrails(callId, turnId, isDev, inputCheckResult ? (inputCheckResult.blocked ? "blocked" : (inputCheckResult.action ?? "allowed")) : "skipped");
  traceLog.kbFetch(callId, turnId, kbPassages.length, agentConfig.kbNamespace);

  if (inputCheckResult) {
    if (inputCheckResult.blocked) {
      logger.warn("input blocked by guardrails", { callId, category: inputCheckResult.category });
      const text = inputCheckResult.message || "Let me connect you with someone who can help.";
      await onSentence(text);
      history.push({ role: "user", content: utterance } as AgentInputItem);
      history.push({ role: "assistant", content: [{ type: "output_text", text }] } as AgentInputItem);
      traceLog.turnEnd(callId, turnId, "transfer", { reason: "guardrails_blocked" });
      return { turnId, action: "transfer", text, agentName: currentAgent.name, history, currentAgent };
    }
    if (inputCheckResult.action === "transfer") {
      const text = "Let me connect you with someone right away.";
      await onSentence(text);
      history.push({ role: "user", content: utterance } as AgentInputItem);
      history.push({ role: "assistant", content: [{ type: "output_text", text }] } as AgentInputItem);
      traceLog.turnEnd(callId, turnId, "transfer", { reason: "guardrails_transfer" });
      return { turnId, action: "transfer", text, agentName: currentAgent.name, history, currentAgent };
    }
    if (inputCheckResult.action === "warn" && inputCheckResult.message) {
      await onSentence(inputCheckResult.message);
      history.push({ role: "assistant", content: [{ type: "output_text", text: inputCheckResult.message }] } as AgentInputItem);
      // fall through — LLM still runs with the de-escalation message visible in history
    }
  }

  // 2. Build per-call context (KB passages injected via dynamic instructions)
  const callContext = buildCallContext(
    callId,
    agentConfig,
    phoneConfig,
    kbPassages,
    currentDateTime ?? new Date().toISOString(),
  );

  // 4. Add user message to history (trim first to prevent context overflow)
  history = trimHistory(history);
  history.push({ role: "user", content: utterance });

  traceLog.runInput(
    callId,
    turnId,
    currentAgent.name,
    history.length,
    summarizeHistoryForTrace(history as unknown as Array<{ role?: string; content?: unknown }>),
    {},
  );

  try {
    // 5. Run the agent (SDK handles routing, tool calls, handoffs)
    logger.info("running agent", { callId, agent: currentAgent.name });

    const stream = (await run(currentAgent as any, history, {
      stream: true,
      context: callContext,
      signal,
    })) as unknown as StreamedRunResult<CallContext, Agent<any, any>>;

    // 6. Stream text through sentence buffer for TTS
    const buffer = new SentenceBuffer();
    let fullText = "";
    let firstTokenMs: number | null = null;

    const textStream = stream.toTextStream({ compatibleWithNodeStreams: true });
    for await (const chunk of textStream) {
      if (signal?.aborted) break;
      const text = typeof chunk === "string" ? chunk : String(chunk);

      if (!firstTokenMs) {
        firstTokenMs = Date.now() - turnStart;
        traceLog.streamFirstToken(callId, turnId, firstTokenMs, currentAgent.name);
        logger.info("first token", { callId, ttft: firstTokenMs, agent: currentAgent.name });
      }

      fullText += text;
      const sentences = buffer.push(text);
      for (const sentence of sentences) {
        await onSentence(sentence);
      }
    }

    const remaining = buffer.flush();
    if (remaining) await onSentence(remaining);

    // 7. Wait for stream to finish
    await stream.completed;

    traceLog.streamComplete(callId, turnId, !stream.error, {});
    if (stream.error) {
      traceLog.streamError(callId, turnId, stream.error instanceof Error ? stream.error.message : String(stream.error));
      throw stream.error;
    }

    // 8. SDK manages history and agent handoffs
    const newHistory = stream.history;
    const newAgent = stream.currentAgent ?? stream.lastAgent ?? currentAgent;
    const agentName = newAgent?.name ?? currentAgent.name;

    const elapsed = Date.now() - turnStart;
    logger.info("turn complete", {
      callId,
      agent: agentName,
      elapsed,
      ttft: firstTokenMs,
      textLen: fullText.length,
      kbHits: kbPassages.length,
    });

    if (!fullText) {
      const fallback = "I'm sorry, could you say that again?";
      await onSentence(fallback);
      traceLog.runOutput(callId, turnId, agentName, "speak", 0, newHistory.length, fallback, { emptyResponse: true });
      traceLog.turnEnd(callId, turnId, "speak", { emptyResponse: true });
      return {
        turnId,
        action: "speak",
        text: fallback,
        agentName,
        history: newHistory,
        currentAgent: newAgent,
      };
    }

    // 9. Detect action from text
    const action = detectActionFromText(fullText);

    // 10. Output guardrails (skip in dev for speed)
    if (!isDev) {
      const outputCheck = await guardrails.checkOutput(fullText, callId);
      if (outputCheck.blocked) {
        logger.warn("output blocked by guardrails", { callId });
        const text = "I apologize, let me connect you with someone who can help.";
        // Return pre-run history with a clean replacement entry — do NOT expose flagged content
        history.push({ role: "assistant", content: [{ type: "output_text", text }] } as AgentInputItem);
        traceLog.runOutput(callId, turnId, agentName, "transfer", fullText.length, history.length, fullText, { outputBlocked: true });
        traceLog.turnEnd(callId, turnId, "transfer", { outputBlocked: true });
        return {
          turnId,
          action: "transfer",
          text,
          agentName,
          history,
          currentAgent: newAgent,
        };
      }
    }

    traceLog.runOutput(callId, turnId, agentName, action, fullText.length, newHistory.length, fullText, {});
    traceLog.turnEnd(callId, turnId, action, {});
    return {
      turnId,
      action,
      text: fullText,
      agentName,
      history: newHistory,
      currentAgent: newAgent,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    traceLog.streamError(callId, turnId, msg);
    if (msg === "Aborted" || signal?.aborted) {
      logger.info("turn aborted (caller hangup)", { callId });
      traceLog.turnEnd(callId, turnId, "aborted", { reason: "signal" });
      throw error;
    }

    logger.error("agent run failed", {
      callId,
      error: msg,
      elapsed: Date.now() - turnStart,
    });

    traceLog.turnEnd(callId, turnId, "speak", { error: true });
    const fallback = "I apologize, I'm having a bit of trouble. Could you repeat that?";
    await onSentence(fallback);
    // Prevent orphaned user entry — pair it with a synthetic assistant reply so history stays valid
    history.push({ role: "assistant", content: [{ type: "output_text", text: fallback }] } as AgentInputItem);
    return {
      turnId,
      action: "speak",
      text: fallback,
      agentName: currentAgent.name,
      history,
      currentAgent,
    };
  }
}

// Re-export the starting agent
export { triageAgent } from "./agents";
export type { CallContext } from "./agents";
