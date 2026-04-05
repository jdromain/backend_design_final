import Redis from "ioredis";

import type { EventEnvelope, EventPayloadByType, EventType, TypedEventEnvelope } from "@rezovo/core-types";

import type { EventBusClient, EventHandler, SubscribeOptions } from "./types";

const channelPrefix = "rezovo:event:";

function channelFor(eventType: string): string {
  return `${channelPrefix}${eventType}`;
}

/**
 * Cross-process pub/sub over Redis. Best-effort delivery (no persistence if subscribers are down).
 * Use for local full-stack so `ConfigChanged` from platform-api reaches realtime-core and
 * `DocIngestRequested` reaches jobs when all services set `EVENT_BUS_IMPL=redis` and share `REDIS_URL`.
 */
export function createRedisEventBus(redisUrl: string): EventBusClient {
  const publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const subscriber = publisher.duplicate({ maxRetriesPerRequest: null });

  type Subscription = { handler: EventHandler; tenantId?: string };
  const handlers = new Map<string, Set<Subscription>>();
  const subscribedChannels = new Set<string>();

  subscriber.on("message", async (channel, message) => {
    if (!channel.startsWith(channelPrefix)) return;
    const eventType = channel.slice(channelPrefix.length);
    let envelope: EventEnvelope<unknown>;
    try {
      envelope = JSON.parse(message) as EventEnvelope<unknown>;
    } catch {
      return;
    }
    const subs = handlers.get(eventType);
    if (!subs) return;
    for (const sub of subs) {
      if (sub.tenantId && sub.tenantId !== envelope.tenant_id) continue;
      await sub.handler(envelope);
    }
  });

  async function ensureSubscribed(eventType: string): Promise<void> {
    const ch = channelFor(eventType);
    if (subscribedChannels.has(ch)) return;
    await subscriber.subscribe(ch);
    subscribedChannels.add(ch);
  }

  return {
    async publish<E extends EventType>(event: TypedEventEnvelope<E>): Promise<void> {
      const ch = channelFor(event.event_type);
      await publisher.publish(ch, JSON.stringify(event));
    },

    async subscribe<E extends EventType>(
      eventType: E,
      handler: EventHandler<EventPayloadByType[E]>,
      options?: SubscribeOptions
    ): Promise<() => Promise<void>> {
      await ensureSubscribed(eventType);
      const set = handlers.get(eventType) ?? new Set<Subscription>();
      const entry: Subscription = { handler: handler as EventHandler, tenantId: options?.tenantId };
      set.add(entry);
      handlers.set(eventType, set);

      return async () => {
        const s = handlers.get(eventType);
        if (!s) return;
        for (const x of s) {
          if (x.handler === handler) s.delete(x);
        }
        if (s.size === 0) {
          handlers.delete(eventType);
          const ch = channelFor(eventType);
          await subscriber.unsubscribe(ch);
          subscribedChannels.delete(ch);
        }
      };
    }
  };
}
