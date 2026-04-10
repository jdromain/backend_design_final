import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";

type LogLevel = "debug" | "info" | "warn" | "error";

type LoggerContext = {
  service: string;
  module?: string;
  orgId?: string;
  callId?: string;
};

type LogPayload = Record<string, unknown> | undefined;

function formatMessage(level: LogLevel, message: string, context: LoggerContext, payload?: LogPayload): string {
  const base = {
    level,
    service: context.service,
    module: context.module,
    org_id: context.orgId,
    call_id: context.callId,
    message,
    ...payload
  };

  return JSON.stringify(base);
}

let fileStream: WriteStream | null = null;
let fileWriteFailed = false;

function logFilePath(): string | undefined {
  const p = process.env.REZOVO_LOG_FILE?.trim();
  return p || undefined;
}

function ensureFileStream(): WriteStream | null {
  if (fileWriteFailed) return null;
  const filePath = logFilePath();
  if (!filePath) return null;
  if (fileStream) return fileStream;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const stream = createWriteStream(filePath, { flags: "a" });
    stream.on("error", (err) => {
      if (!fileWriteFailed) {
        fileWriteFailed = true;
        console.error("[rezovo/logging] log file stream error, disabling file tee:", (err as Error).message);
      }
      try {
        stream.destroy();
      } catch {
        /* ignore */
      }
      fileStream = null;
    });
    fileStream = stream;
    return stream;
  } catch (err) {
    fileWriteFailed = true;
    console.error("[rezovo/logging] could not open REZOVO_LOG_FILE:", (err as Error).message);
    return null;
  }
}

function writeLineToFile(line: string): void {
  const stream = ensureFileStream();
  if (!stream || !stream.writable) return;
  try {
    stream.write(`${line}\n`);
  } catch (err) {
    fileWriteFailed = true;
    console.error("[rezovo/logging] log file write failed:", (err as Error).message);
  }
}

/**
 * Append one JSONL record (same file as `createLogger` when `REZOVO_LOG_FILE` is set).
 * Used by platform-api HTTP / error hooks.
 */
export function appendRezovoJsonlLine(jsonLine: string): void {
  if (!logFilePath() || fileWriteFailed) return;
  writeLineToFile(jsonLine);
}

export function createLogger(context: LoggerContext) {
  const emit = (level: LogLevel, message: string, payload?: LogPayload): void => {
    const line = formatMessage(level, message, context, payload);
    if (level === "debug") console.debug(line);
    else if (level === "info") console.info(line);
    else if (level === "warn") console.warn(line);
    else console.error(line);
    writeLineToFile(line);
  };

  return {
    debug(message: string, payload?: LogPayload): void {
      emit("debug", message, payload);
    },
    info(message: string, payload?: LogPayload): void {
      emit("info", message, payload);
    },
    warn(message: string, payload?: LogPayload): void {
      emit("warn", message, payload);
    },
    error(message: string, payload?: LogPayload): void {
      emit("error", message, payload);
    }
  };
}
