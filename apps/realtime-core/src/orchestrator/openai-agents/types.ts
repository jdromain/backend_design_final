/**
 * types.ts -- Shared types for the OpenAI Agents workflow.
 */

import type { AgentInputItem } from "@openai/agents";
import type { AgentConfigSnapshot, PhoneNumberConfig } from "@rezovo/core-types";

export interface WorkflowInput {
  utterance: string;
  callId: string;
  conversationHistory: AgentInputItem[];
  agentConfig: AgentConfigSnapshot;
  phoneConfig: PhoneNumberConfig;
}

export interface WorkflowResult {
  action: "speak" | "transfer" | "end";
  text: string;
  intent?: string;
  confidence?: number;
  extracted?: Record<string, unknown>;
  toolResult?: unknown;
}

export type OnSentenceCallback = (sentence: string) => void | Promise<void>;
