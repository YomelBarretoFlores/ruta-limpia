/** A map from event name to payload type, for example `{ 'trip.started': TripStarted }`. */
export type EventMap = object;

export type EventHandler<TPayload> = (payload: TPayload) => void;

/**
 * Typed in-process publish/subscribe port. Publishers never wait for subscribers, and a failing
 * subscriber must not break the publisher (adapters isolate handler errors).
 */
export interface EventBus<TEvents extends EventMap> {
  publish<K extends keyof TEvents & string>(name: K, payload: TEvents[K]): void;
  /** Registers a handler and returns a function that removes it. */
  subscribe<K extends keyof TEvents & string>(
    name: K,
    handler: EventHandler<TEvents[K]>,
  ): () => void;
}
