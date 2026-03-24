import { EventBusClient, createEventEnvelope } from "@rezovo/event-bus";
import { CallEndedPayload, CallStartedPayload, UsageReportedPayload } from "@rezovo/core-types";

export class EventPublisher {
  constructor(private bus: EventBusClient) {}

  async callStarted(payload: CallStartedPayload & { tenantId: string; callId: string; lob?: string }) {
    const envelope = createEventEnvelope({
      eventType: "CallStarted",
      tenantId: payload.tenantId,
      callId: payload.callId,
      payload: {
        did: payload.did,
        businessId: payload.businessId,
        routeType: payload.routeType,
        agentConfigId: payload.agentConfigId,
        agentConfigVersion: payload.agentConfigVersion,
        startedAt: payload.startedAt
      }
    });
    await this.bus.publish(envelope);
    return envelope.event_id;
  }

  async callEnded(payload: CallEndedPayload & { tenantId: string; callId: string; lob?: string }) {
    const envelope = createEventEnvelope({
      eventType: "CallEnded",
      tenantId: payload.tenantId,
      callId: payload.callId,
      payload: {
        did: payload.did,
        businessId: payload.businessId,
        routeType: payload.routeType,
        agentConfigId: payload.agentConfigId,
        agentConfigVersion: payload.agentConfigVersion,
        startedAt: payload.startedAt,
        endedAt: payload.endedAt,
        durationMs: payload.durationMs,
        endReason: payload.endReason,
        outcome: payload.outcome,
        usage: payload.usage
      }
    });
    await this.bus.publish(envelope);
    return envelope.event_id;
  }

  async usageReported(payload: UsageReportedPayload & { tenantId: string; callId: string }) {
    const envelope = createEventEnvelope({
      eventType: "UsageReported",
      tenantId: payload.tenantId,
      callId: payload.callId,
      payload: {
        usage: payload.usage,
        callStartedAt: payload.callStartedAt,
        callEndedAt: payload.callEndedAt,
        metadata: payload.metadata
      }
    });
    await this.bus.publish(envelope);
    return envelope.event_id;
  }
}









