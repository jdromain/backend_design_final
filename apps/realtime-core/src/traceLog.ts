/**
 * Trace logger: writes all LLM/system trace entries to logs/realtime-core.log
 * for diagnosing issues. Does not change any business logic.
 */

import * as fs from "fs";
import * as path from "path";

const LOG_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "realtime-core.log");

function ensureLogDir(): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function writeLine(entry: Record<string, unknown>): void {
  try {
    ensureLogDir();
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    fs.appendFileSync(LOG_FILE, line);
  } catch (err) {
    console.error("[traceLog] write failed", (err as Error).message);
  }
}

export const traceLog = {
  /** Generic trace entry */
  trace(tag: string, message: string, payload?: Record<string, unknown>): void {
    writeLine({ tag, message, ...payload });
  },

  /** Call lifecycle */
  callStart(callId: string, payload?: Record<string, unknown>): void {
    writeLine({ tag: "call_start", callId, message: "call started", ...payload });
  },
  callEnd(callId: string, payload?: Record<string, unknown>): void {
    writeLine({ tag: "call_end", callId, message: "call ended", ...payload });
  },

  /** STT: final transcript from speech-to-text */
  sttFinal(callId: string, text: string, payload?: Record<string, unknown>): void {
    writeLine({ tag: "stt_final", callId, message: "stt final transcript", text, textLen: text.length, ...payload });
  },

  /** Turn: user input passed to orchestrator */
  turnStart(callId: string, turnId: string, utterance: string, payload?: Record<string, unknown>): void {
    writeLine({
      tag: "turn_start",
      callId,
      turnId,
      message: "turn started",
      utterance,
      utteranceLen: utterance.length,
      ...payload,
    });
  },
  turnEnd(callId: string, turnId: string, action: string, payload?: Record<string, unknown>): void {
    writeLine({ tag: "turn_end", callId, turnId, message: "turn ended", action, ...payload });
  },

  /** Pre-run: guardrails and KB */
  guardrails(callId: string, turnId: string, skipped: boolean, result: string, payload?: Record<string, unknown>): void {
    writeLine({ tag: "guardrails", callId, turnId, message: "guardrails result", skipped, result, ...payload });
  },
  kbFetch(callId: string, turnId: string, passageCount: number, namespace?: string): void {
    writeLine({ tag: "kb_fetch", callId, turnId, message: "kb passages fetched", passageCount, namespace });
  },

  /** LLM input: exact payload we send to run() */
  runInput(
    callId: string,
    turnId: string,
    agentName: string,
    historyLength: number,
    historySummary: Array<{ role: string; contentKind: string; contentLen?: number; textPreview?: string }>,
    payload?: Record<string, unknown>
  ): void {
    writeLine({
      tag: "llm_run_input",
      callId,
      turnId,
      message: "payload sent to run()",
      agentName,
      historyLength,
      historySummary,
      ...payload,
    });
  },

  /** LLM stream: first token and completion */
  streamFirstToken(callId: string, turnId: string, ttftMs: number, agentName: string): void {
    writeLine({ tag: "llm_first_token", callId, turnId, message: "first token received", ttftMs, agentName });
  },
  streamComplete(callId: string, turnId: string, success: boolean, payload?: Record<string, unknown>): void {
    writeLine({ tag: "llm_stream_complete", callId, turnId, message: "stream completed", success, ...payload });
  },
  streamError(callId: string, turnId: string, error: string): void {
    writeLine({ tag: "llm_stream_error", callId, turnId, message: "stream error", error });
  },

  /** LLM output: what we got back */
  runOutput(
    callId: string,
    turnId: string,
    agentName: string,
    action: string,
    textLen: number,
    newHistoryLength: number,
    textPreview: string,
    payload?: Record<string, unknown>
  ): void {
    writeLine({
      tag: "llm_run_output",
      callId,
      turnId,
      message: "result from run()",
      agentName,
      action,
      textLen,
      newHistoryLength,
      textPreview: textPreview.slice(0, 200),
      ...payload,
    });
  },

  /** Session: greeting, response type */
  sessionGreet(callId: string, greetingLen: number): void {
    writeLine({ tag: "session_greet", callId, message: "greeting sent", greetingLen });
  },
  sessionResponse(callId: string, turnId: string, responseType: string, textPreview?: string): void {
    writeLine({ tag: "session_response", callId, turnId, message: "orchestrator response", responseType, textPreview: textPreview?.slice(0, 150) });
  },
};

/** Helper to summarize history for tracing (no PII, just shape) */
export function summarizeHistoryForTrace(history: Array<{ role?: string; content?: unknown }>): Array<{ role: string; contentKind: string; contentLen?: number; textPreview?: string }> {
  return history.map((item) => {
    const role = (item.role ?? "unknown") as string;
    const content = item.content;
    let contentKind = "unknown";
    let contentLen: number | undefined;
    let textPreview: string | undefined;
    if (Array.isArray(content)) {
      contentKind = "array";
      contentLen = content.length;
      const parts = content as Array<{ type?: string; text?: string }>;
      const types = parts.map((p) => p?.type ?? "?").join(",");
      const firstText = parts.find((p) => typeof p?.text === "string")?.text;
      if (firstText) textPreview = firstText.slice(0, 80);
      contentKind = `array[${types}]`;
    } else if (typeof content === "string") {
      contentKind = "string";
      contentLen = content.length;
      textPreview = content.slice(0, 80);
    }
    return { role, contentKind, contentLen, textPreview };
  });
}
