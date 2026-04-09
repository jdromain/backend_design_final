/**
 * callPersistence.ts
 *
 * Client for persisting call records, transcripts, and events to
 * platform-api's /calls/* endpoints (which write to Postgres).
 *
 * All writes are fire-and-forget — failures are logged but never
 * block the real-time voice pipeline.
 */

import { createLogger } from "@rezovo/logging";
import { env } from "./env";
import { internalApiHeaders } from "./platformApiAuth";

const logger = createLogger({ service: "realtime-core", module: "callPersistence" });

const DEFAULT_PLATFORM_API = "http://localhost:3001";

function getBase(): string {
  return env.PLATFORM_API_URL || DEFAULT_PLATFORM_API;
}

export interface CallStartPayload {
  callId: string;
  tenantId: string;
  phoneNumber: string;
  callerNumber: string;
  twilioCallSid?: string;
  direction?: "inbound" | "outbound";
  agentConfigId?: string;
  agentConfigVer?: number;
  startedAt: string;
}

export interface CallEndPayload {
  callId: string;
  tenantId: string;
  endReason?: string;
  outcome?: string;
  failureType?: string;
  durationSec?: number;
  classifiedIntent?: string;
  intentConfidence?: number;
  finalIntent?: string;
  slotsCollected?: Record<string, unknown>;
  turnCount?: number;
  llmTokensIn?: number;
  llmTokensOut?: number;
  ttsChars?: number;
  sttSeconds?: number;
  transcript?: TranscriptLine[];
}

export interface TranscriptLine {
  sequence: number;
  speaker: "user" | "agent";
  text: string;
  confidence?: number;
  spokenAt: string;
  durationMs?: number;
}

export interface CallEventPayload {
  callId: string;
  tenantId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}

/**
 * Fire-and-forget: POST to platform-api with retry (1 attempt).
 */
async function safeFetch(path: string, body: unknown): Promise<void> {
  const url = `${getBase()}${path}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: internalApiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn("call persistence request failed", { url, status: res.status, body: text.slice(0, 200) });
    }
  } catch (err) {
    logger.warn("call persistence request error", { url, error: (err as Error).message });
  }
}

/**
 * Notify platform-api that a call has started (writes to `calls` table).
 */
export async function persistCallStart(payload: CallStartPayload): Promise<void> {
  await safeFetch("/calls/start", payload);
  logger.debug("persisted call start", { callId: payload.callId });
}

/**
 * Notify platform-api that a call has ended with full data + transcript.
 */
export async function persistCallEnd(payload: CallEndPayload): Promise<void> {
  await safeFetch("/calls/end", payload);
  logger.info("persisted call end", {
    callId: payload.callId,
    outcome: payload.outcome,
    failureType: payload.failureType,
    durationSec: payload.durationSec,
    intent: payload.classifiedIntent,
    turns: payload.turnCount,
    transcriptLines: payload.transcript?.length ?? 0,
  });
}

/**
 * Log a mid-call event (intent classified, tool called, etc.)
 */
export async function persistCallEvent(payload: CallEventPayload): Promise<void> {
  await safeFetch("/calls/event", payload);
}
