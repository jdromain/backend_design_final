import http from "http";
import { createLogger } from "@rezovo/logging";
import { CallController, InboundCallArgs } from "./telephony/callController";

const logger = createLogger({ service: "realtime-core", module: "webhookServer" });

export function startWebhookServer(callController: CallController, port = 3002): void {
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
            tenantId: callData.tenantId,
            callerNumber: callData.callerNumber
          });
          
          // Trigger call handling asynchronously
          callController.handleInboundCall(callData).catch((err) => {
            logger.error("call handling failed", { 
              error: (err as Error).message,
              callId: callData.did
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
  
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPERM" || err.code === "EADDRINUSE") {
      logger.warn("webhook server could not bind to port, skipping", { port, error: err.message });
    } else {
      logger.error("webhook server error", { error: err.message });
    }
  });

  server.listen(port, "0.0.0.0", () => {
    logger.info("realtime-core webhook server started", { port, host: "0.0.0.0" });
  });
}

