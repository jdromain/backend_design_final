import type { EventEnvelope, EventPayloadByType, EventType, TypedEventEnvelope } from "@rezovo/core-types";

export type EventHandler<T = unknown> = (event: EventEnvelope<T>) => Promise<void>;

export type SubscribeOptions = {
  tenantId?: string;
};

export interface EventBusClient {
  publish<E extends EventType>(event: TypedEventEnvelope<E>): Promise<void>;
  subscribe<E extends EventType>(
    eventType: E,
    handler: EventHandler<EventPayloadByType[E]>,
    options?: SubscribeOptions
  ): Promise<() => Promise<void>>;
}
