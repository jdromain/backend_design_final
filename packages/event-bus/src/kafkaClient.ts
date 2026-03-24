import { EventBusClient, SubscribeOptions, EventHandler } from "./index";
import { EventType, TypedEventEnvelope, EventPayloadByType } from "@rezovo/core-types";

type KafkaConfig = {
  brokers: string[];
  clientId: string;
};

export function createKafkaEventBus(_config: KafkaConfig): EventBusClient {
  // Placeholder implementation: extend with real Kafka producer/consumer wiring.
  return {
    async publish<E extends EventType>(_event: TypedEventEnvelope<E>): Promise<void> {
      throw new Error("Kafka publish not implemented");
    },
    async subscribe<E extends EventType>(
      _eventType: E,
      _handler: EventHandler<EventPayloadByType[E]>,
      _options?: SubscribeOptions
    ): Promise<() => Promise<void>> {
      throw new Error("Kafka subscribe not implemented");
    }
  };
}

