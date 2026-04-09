import { randomUUID } from "node:crypto";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

import { appendRezovoJsonlLine, createLogger } from "@rezovo/logging";

import { env } from "../env";

declare module "fastify" {
  interface FastifyRequest {
    _rezovoRequestStartedNs?: bigint;
    _rezovoRequestId?: string;
  }
}

const MAX_QUERY_LEN = 200;
const MAX_PATH_LEN = 512;

function headerString(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v[0]) return v[0];
  return undefined;
}

/** Path + truncated query; never includes fragments. */
export function safeUrlPath(rawUrl: string): string {
  const [pathnameAndQuery] = rawUrl.split("#", 1);
  const q = pathnameAndQuery.indexOf("?");
  if (q === -1) {
    return pathnameAndQuery.length <= MAX_PATH_LEN
      ? pathnameAndQuery
      : pathnameAndQuery.slice(0, MAX_PATH_LEN) + "…";
  }
  const pathPart = pathnameAndQuery.slice(0, q);
  let query = pathnameAndQuery.slice(q + 1);
  if (query.length > MAX_QUERY_LEN) {
    query = query.slice(0, MAX_QUERY_LEN) + "…";
  }
  const combined = `${pathPart}?${query}`;
  return combined.length <= MAX_PATH_LEN ? combined : combined.slice(0, MAX_PATH_LEN) + "…";
}

function pickRequestId(request: FastifyRequest): string {
  const fromHeader =
    headerString(request, "x-request-id") ?? headerString(request, "X-Request-Id");
  if (fromHeader?.trim()) return fromHeader.trim();
  return randomUUID();
}

/**
 * JSONL: `http_request` on entry, `http_response` on completion (all status codes).
 */
export function registerHttpAccessLogging(app: {
  addHook(name: string, fn: (req: FastifyRequest, reply: FastifyReply) => void | Promise<void>): void;
}): void {
  app.addHook("onRequest", async (request: FastifyRequest, _reply: FastifyReply) => {
    request._rezovoRequestId = pickRequestId(request);
    request._rezovoRequestStartedNs = process.hrtime.bigint();

    const ua = headerString(request, "user-agent");
    const cl = headerString(request, "content-length");

    const record = {
      kind: "http_request" as const,
      service: "platform-api",
      level: "info" as const,
      requestId: request._rezovoRequestId,
      method: request.method,
      path: safeUrlPath(request.url),
      userAgent: ua ? ua.slice(0, 200) : undefined,
      contentLength: cl,
      remoteAddress: request.ip
    };
    appendRezovoJsonlLine(JSON.stringify(record));
  });

  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const start = request._rezovoRequestStartedNs;
    const ms =
      start !== undefined ? Number(process.hrtime.bigint() - start) / 1e6 : 0;
    const status = reply.statusCode;
    const level: "info" | "warn" | "error" =
      status >= 500 ? "error" : status >= 400 ? "warn" : "info";

    const record = {
      kind: "http_response" as const,
      service: "platform-api",
      level,
      requestId: request._rezovoRequestId ?? "unknown",
      method: request.method,
      path: safeUrlPath(request.url),
      statusCode: status,
      responseTimeMs: Math.round(ms * 1000) / 1000
    };
    appendRezovoJsonlLine(JSON.stringify(record));
  });
}

const errorLog = createLogger({ service: "platform-api", module: "httpError" });

/**
 * JSONL `http_error` for thrown errors / validation failures, then existing 500 JSON body.
 */
export function registerHttpErrorLogging(app: {
  setErrorHandler(
    fn: (error: Error & FastifyError, request: FastifyRequest, reply: FastifyReply) => void
  ): void;
}): void {
  app.setErrorHandler((error: Error & FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request._rezovoRequestId ?? "unknown";
    const statusFromErr =
      typeof error.statusCode === "number" && error.statusCode >= 400 ? error.statusCode : undefined;
    const statusCode = statusFromErr ?? (reply.statusCode >= 400 ? reply.statusCode : 500);

    const payload: Record<string, unknown> = {
      kind: "http_error",
      service: "platform-api",
      level: "error",
      requestId,
      method: request.method,
      path: safeUrlPath(request.url),
      statusCode,
      errorName: error.name,
      errorMessage: error.message,
      errorCode: error.code
    };

    if (error.validation) {
      payload.validation = error.validation;
    }

    const allowStack = env.NODE_ENV !== "production" || env.LOG_STACK_TRACES;
    if (allowStack && error.stack) {
      payload.stack = error.stack.slice(0, 8000);
    }

    appendRezovoJsonlLine(JSON.stringify(payload));

    errorLog.error("platform-api error", { error: error.message });

    reply.status(500).send({ error: "internal_error" });
  });
}
