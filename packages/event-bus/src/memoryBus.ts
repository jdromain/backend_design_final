import { randomUUID } from "crypto";

import type { EventEnvelope, EventPayloadByType, EventType, TypedEventEnvelope } from "@rezovo/core-types";

import type { EventBusClient, EventHandler, SubscribeOptions } from "./types";

export function createInMemoryEventBus(): EventBusClient {
  type Subscription = { handler: EventHandler; tenantId?: string };
  const handlers = new Map<string, Set<Subscription>>();

  return {
    async publish<E extends EventType>(event: TypedEventEnvelope<E>): Promise<void> {
      const subscribers = handlers.get(event.event_type);
      if (!subscribers) return;

      for (const subscriber of subscribers) {
        if (subscriber.tenantId && subscriber.tenantId !== event.tenant_id) {
          continue;
        }
        await subscriber.handler(event);
      }
    },
    async subscribe<E extends EventType>(
      eventType: E,
      handler: EventHandler<EventPayloadByType[E]>,
      options?: SubscribeOptions
    ): Promise<() => Promise<void>> {
      const existing = handlers.get(eventType) ?? new Set<Subscription>();
      existing.add({ handler: handler as EventHandler, tenantId: options?.tenantId });
      handlers.set(eventType, existing);

      return async () => {
        const set = handlers.get(eventType);
        if (!set) return;
        for (const entry of set) {
          if (entry.handler === handler) {
            set.delete(entry);
          }
        }
        if (set.size === 0) {
          handlers.delete(eventType);
        }
      };
    }
  };
}

export function createEventEnvelope<E extends EventType>(params: {
  eventType: E;
  tenantId: string;
  payload: EventPayloadByType[E];
  callId?: string;
  timestamp?: string;
  eventId?: string;
}): TypedEventEnvelope<E> {
  const { eventType, tenantId, payload, callId, timestamp, eventId } = params;
  return {
    event_id: eventId ?? randomUUID(),
    event_type: eventType,
    tenant_id: tenantId,
    call_id: callId,
    timestamp: timestamp ?? new Date().toISOString(),
    payload
  };
}
