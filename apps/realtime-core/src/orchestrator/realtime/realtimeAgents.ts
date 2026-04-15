import type { Agent } from "@openai/agents";
import { RealtimeAgent } from "@openai/agents/realtime";
import type { CallContext } from "../openai-agents/agents";
import {
  bookingAgent,
  cancelAgent,
  complaintAgent,
  getStartingAgent,
  infoAgent,
  triageAgent,
} from "../openai-agents/agents";

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

const realtimeReceptionist = toRealtimeAgent(triageAgent);
const realtimeBooking = toRealtimeAgent(bookingAgent);
const realtimeCancellation = toRealtimeAgent(cancelAgent);
const realtimeComplaint = toRealtimeAgent(complaintAgent);
const realtimeInfo = toRealtimeAgent(infoAgent);

realtimeReceptionist.handoffs = [
  realtimeBooking,
  realtimeCancellation,
  realtimeComplaint,
  realtimeInfo,
];

realtimeBooking.handoffs = [realtimeReceptionist, realtimeCancellation, realtimeInfo];
realtimeCancellation.handoffs = [realtimeReceptionist, realtimeBooking, realtimeInfo];
realtimeComplaint.handoffs = [realtimeReceptionist, realtimeInfo];
realtimeInfo.handoffs = [realtimeReceptionist, realtimeBooking, realtimeCancellation, realtimeComplaint];

const REALTIME_AGENT_BY_NAME: Record<string, RealtimeAgent<CallContext>> = {
  [realtimeReceptionist.name]: realtimeReceptionist,
  [realtimeBooking.name]: realtimeBooking,
  [realtimeCancellation.name]: realtimeCancellation,
  [realtimeComplaint.name]: realtimeComplaint,
  [realtimeInfo.name]: realtimeInfo,
};

export function getStartingRealtimeAgent(): RealtimeAgent<CallContext> {
  const starting = getStartingAgent();
  return REALTIME_AGENT_BY_NAME[starting.name] ?? realtimeReceptionist;
}

export function getRealtimeAgentByName(name: string | null | undefined): RealtimeAgent<CallContext> | null {
  if (!name) return null;
  return REALTIME_AGENT_BY_NAME[name] ?? null;
}
