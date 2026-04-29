import type { Agent } from "@openai/agents";
import { RealtimeAgent } from "@openai/agents/realtime";
import type { CallContext } from "../openai-agents/agents";
import { assistantAgent, getStartingAgent } from "../openai-agents/agents";

type StandardAgent = Agent<CallContext, any>;

function toRealtimeAgent(source: StandardAgent): RealtimeAgent<CallContext> {
  const sourceRecord = source as unknown as {
    handoffDescription?: string;
    instructions?: unknown;
    tools?: unknown[];
  };

  return new RealtimeAgent<CallContext>({
    name: source.name,
    handoffDescription: sourceRecord.handoffDescription,
    instructions: sourceRecord.instructions as any,
    tools: (sourceRecord.tools ?? []) as any,
  });
}

const realtimeAssistant = toRealtimeAgent(assistantAgent);

const REALTIME_AGENT_BY_NAME: Record<string, RealtimeAgent<CallContext>> = {
  [realtimeAssistant.name]: realtimeAssistant,
};

export function getStartingRealtimeAgent(): RealtimeAgent<CallContext> {
  const starting = getStartingAgent();
  return REALTIME_AGENT_BY_NAME[starting.name] ?? realtimeAssistant;
}

export function getRealtimeAgentByName(_name: string | null | undefined): RealtimeAgent<CallContext> | null {
  return realtimeAssistant;
}
