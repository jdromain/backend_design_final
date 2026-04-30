import http from "http";
import { createHmac, timingSafeEqual } from "crypto";
import { createLogger } from "@rezovo/logging";
import { CallController, InboundCallArgs } from "./telephony/callController";
import { env } from "./env";

const logger = createLogger({ service: "realtime-core", module: "webhookServer" });

/** Fixed port for /health and /inbound-call — must match platform-api REALTIME_CORE_URL. */
export const WEBHOOK_LISTEN_PORT = env.WEBHOOK_LISTEN_PORT;

const DEDUPE_TTL_MS = 5 * 60 * 1_000;
const DEDUPE_MAX = 2_000;
const seenCallIds = new Map<string, number>();

function pruneDedupe(now: number): void {
  for (const [k, t] of seenCallIds) {
    if (now - t > DEDUPE_TTL_MS) seenCallIds.delete(k);
  }
  if (seenCallIds.size > DEDUPE_MAX) {
    const entries = [...seenCallIds.entries()].sort((a, b) => a[1] - b[1]);
    while (entries.length > DEDUPE_MAX / 2) {
      const drop = entries.shift();
      if (drop) seenCallIds.delete(drop[0]);
    }
  }
}

export function reserveCallId(callId: string | undefined): boolean {
  if (!callId) return false;
  const now = Date.now();
  pruneDedupe(now);
  if (seenCallIds.has(callId)) {
    return false;
  }
  seenCallIds.set(callId, now);
  return true;
}

export function releaseCallId(callId: string | undefined): void {
  if (!callId) return;
  seenCallIds.delete(callId);
}

function verifySignature(rawBody: string, headerSig: string | undefined): boolean {
  const secret = env.INTERNAL_WEBHOOK_SECRET?.trim();
  if (!secret) {
    if (env.NODE_ENV === "production") {
      logger.error("INTERNAL_WEBHOOK_SECRET is required in production for /inbound-call");
      return false;
    }
    return true;
  }
  if (!headerSig || !headerSig.startsWith("sha256=")) return false;
  const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const got = headerSig.slice("sha256=".length);
  if (expectedHex.length !== got.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expectedHex, "utf8"), Buffer.from(got, "utf8"));
  } catch {
    return false;
  }
}

export function startWebhookServer(
  callController: CallController,
  port = WEBHOOK_LISTEN_PORT
): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // Health check
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", service: "realtime-core-webhook" }));
        return;
      }

      // Inbound call notification from platform-api
      if (req.url === "/inbound-call" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", async () => {
          try {
            const raw = body;
            const sig = req.headers["x-rezovo-signature"];
            if (!verifySignature(raw, typeof sig === "string" ? sig : Array.isArray(sig) ? sig[0] : undefined)) {
              res.writeHead(401, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "unauthorized" }));
              return;
            }

            const callData: InboundCallArgs = JSON.parse(raw);
            logger.info("received inbound call notification from platform-api", {
              did: callData.did,
              orgId: callData.orgId,
              callerNumber: callData.callerNumber,
              callId: callData.callId,
            });

            if (!reserveCallId(callData.callId)) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true, message: "duplicate call ignored" }));
              return;
            }

            // Trigger call handling asynchronously
            callController.handleInboundCall(callData).catch((err) => {
              releaseCallId(callData.callId);
              logger.error("call handling failed", {
                error: (err as Error).message,
                callId: callData.callId,
              });
            });

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, message: "call accepted" }));
          } catch (err) {
            logger.error("webhook processing error", { error: (err as Error).message });
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_payload" }));
          }
        });
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    });

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPERM" || err.code === "EADDRINUSE") {
        logger.error(
          `webhook server cannot bind to port ${port} — stop the other process using this port (e.g. duplicate realtime-core)`,
          { port, code: err.code, error: err.message }
        );
      } else {
        logger.error("webhook server error", { error: err.message });
      }
      reject(err);
    });

    server.listen(port, "0.0.0.0", () => {
      logger.info("realtime-core webhook server started", { port, host: "0.0.0.0" });
      resolve();
    });
  });
}
