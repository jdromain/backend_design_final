import { EventEmitter } from "events";
import WebSocket from "ws";
import { createLogger } from "@rezovo/logging";
import { env } from "../env";

const logger = createLogger({ service: "realtime-core", module: "rtpBridgeClient" });

export type MediaSessionSnapshot = {
  callId: string;
  did: string;
  orgId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  callerFrames: number;
  agentFrames: number;
};

export type AudioFrame = {
  payload: Buffer;
  timestamp: number;
};

export interface RtpBridgeConnection {
  callId: string;
  onAudio(callback: (frame: AudioFrame) => void): void;
  onClose(callback: () => void): void;
  onError(callback: (error: Error) => void): void;
  sendAudio(frame: AudioFrame): void;
  clearPlayback(): void;
  close(): void;
}

export type RtpBridgeClientOptions = {
  bridgeUrl?: string;
  authToken?: string;
  mock?: boolean;
};

export class RtpBridgeClient {
  private mock: boolean;
  private baseUrl: string;
  private authToken?: string;

  constructor(opts?: RtpBridgeClientOptions) {
    this.mock = opts?.mock ?? true;
    this.baseUrl = opts?.bridgeUrl ?? (env.RTP_BRIDGE_URL || "http://localhost:8081");
    this.authToken = opts?.authToken;
  }

  async startSession(params: { callId: string; did: string; orgId: string }): Promise<MediaSession> {
    if (this.mock) {
      return MediaSession.mock(params);
    }
    // Placeholder: a real implementation would open a gRPC/HTTP stream here.
    return MediaSession.mock(params);
  }

  async connect(callId: string): Promise<RtpBridgeConnection> {
    if (this.mock) {
      return new MockRtpBridgeConnection(callId);
    }

    const bridgeUrl = this.baseUrl.replace("http://", "ws://").replace("https://", "wss://");
    const wsUrl = `${bridgeUrl}/ws/media?call_id=${callId}`;
    
    const ws = new WebSocket(wsUrl, {
      headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : undefined
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("RTP bridge connection timeout"));
      }, Math.max(500, env.RTP_BRIDGE_CONNECT_TIMEOUT_MS));

      ws.once("open", () => {
        clearTimeout(timeout);
        logger.info("Connected to RTP bridge", { callId, url: wsUrl });
        resolve(new RealRtpBridgeConnection(callId, ws));
      });

      ws.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
}

export class MediaSession extends EventEmitter {
  private callerFrames = 0;
  private agentFrames = 0;
  private readonly startedAt = Date.now();
  private endedAt: number | null = null;

  private constructor(private callId: string, private did: string, private orgId: string) {
    super();
  }

  static mock(params: { callId: string; did: string; orgId: string }): MediaSession {
    return new MediaSession(params.callId, params.did, params.orgId);
  }

  markCallerFrame(bytes: number): void {
    this.callerFrames += bytes;
    this.emit("caller_frame", bytes);
  }

  markAgentFrame(bytes: number): void {
    this.agentFrames += bytes;
    this.emit("agent_frame", bytes);
  }

  stop(): MediaSessionSnapshot {
    this.endedAt = Date.now();
    return this.snapshot();
  }

  snapshot(): MediaSessionSnapshot {
    const end = this.endedAt ?? Date.now();
    return {
      callId: this.callId,
      did: this.did,
      orgId: this.orgId,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date(end).toISOString(),
      durationMs: end - this.startedAt,
      callerFrames: this.callerFrames,
      agentFrames: this.agentFrames
    };
  }
}

class MockRtpBridgeConnection implements RtpBridgeConnection {
  callId: string;
  constructor(callId: string) {
    this.callId = callId;
  }
  onAudio(_callback: (frame: AudioFrame) => void): void {}
  onClose(_callback: () => void): void {}
  onError(_callback: (error: Error) => void): void {}
  sendAudio(_frame: AudioFrame): void {}
  clearPlayback(): void {}
  close(): void {}
}

class RealRtpBridgeConnection implements RtpBridgeConnection {
  callId: string;
  private ws: WebSocket;
  private framesSent = 0;
  private bytesSent = 0;
  private audioCallback: ((frame: AudioFrame) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;

  constructor(callId: string, ws: WebSocket) {
    this.callId = callId;
    this.ws = ws;

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "audio" && msg.payload) {
          // Audio from rtp-bridge (caller speech) → feed to STT
          const frame: AudioFrame = {
            payload: Buffer.from(msg.payload, "base64"),
            timestamp: Date.now()
          };
          if (this.audioCallback) {
            this.audioCallback(frame);
          }
        }
      } catch (err) {
        logger.error("Failed to parse RTP bridge message", { error: (err as Error).message });
      }
    });

    ws.on("close", () => {
      logger.info("RTP bridge connection closed", { callId });
      if (this.closeCallback) {
        this.closeCallback();
      }
    });

    ws.on("error", (err) => {
      logger.error("RTP bridge WebSocket error", { error: err.message, callId });
      if (this.errorCallback) {
        this.errorCallback(err);
      }
    });
  }

  onAudio(callback: (frame: AudioFrame) => void): void {
    this.audioCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  sendAudio(frame: AudioFrame): void {
    if (this.ws.readyState === 1) { // 1 = OPEN
      try {
        const msg = JSON.stringify({
          type: "audio",
          payload: frame.payload.toString("base64")
        });
        this.ws.send(msg);
        this.framesSent++;
        this.bytesSent += frame.payload.length;
        
        if (this.framesSent % 50 === 0) {
          logger.debug("rtp_bridge_egress_progress", {
            callId: this.callId,
            frames: this.framesSent,
            bytes: this.bytesSent
          });
        }
      } catch (err) {
        logger.error("Failed to send audio to RTP bridge", { error: (err as Error).message });
      }
    }
  }

  clearPlayback(): void {
    if (this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify({ type: "clear" }));
        logger.info("rtp_bridge_clear_sent", { callId: this.callId });
      } catch (err) {
        logger.warn("Failed to send clear to RTP bridge", {
          callId: this.callId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  close(): void {
    if (this.ws.readyState === 1) { // 1 = OPEN
      this.ws.send(JSON.stringify({ type: "end" }));
    }
    this.ws.close();
  }
}
