import http from "http";
import { createLogger } from "@rezovo/logging";
import { CallController, InboundCallArgs } from "./telephony/callController";

const logger = createLogger({ service: "realtime-core", module: "webhookServer" });

/** Fixed port for /health and /inbound-call — must match platform-api REALTIME_CORE_URL. */
export const WEBHOOK_LISTEN_PORT = 3002;

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
            const callData: InboundCallArgs = JSON.parse(body);
            logger.info("received inbound call notification from platform-api", {
              did: callData.did,
              orgId: callData.orgId,
              callerNumber: callData.callerNumber,
            });

            // Trigger call handling asynchronously
            callController.handleInboundCall(callData).catch((err) => {
              logger.error("call handling failed", {
                error: (err as Error).message,
                callId: callData.did,
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
