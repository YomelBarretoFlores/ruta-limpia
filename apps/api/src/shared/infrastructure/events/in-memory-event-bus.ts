import type { EventBus, EventHandler, EventMap } from '../../application/event-bus.js';
import type { Logger } from '../../application/logger.js';

/**
 * Synchronous in-process event bus. Handlers run in subscription order; a throwing handler is
 * logged and skipped so it can never break the publisher or the other handlers.
 */
export class InMemoryEventBus<TEvents extends EventMap> implements EventBus<TEvents> {
  private readonly handlers = new Map<string, Set<EventHandler<never>>>();

  constructor(private readonly logger: Logger) {}

  publish<K extends keyof TEvents & string>(name: K, payload: TEvents[K]): void {
    for (const handler of this.handlers.get(name) ?? []) {
      try {
        (handler as EventHandler<TEvents[K]>)(payload);
      } catch (error) {
        this.logger.error({ err: error, event: name }, 'Event handler failed');
      }
    }
  }

  subscribe<K extends keyof TEvents & string>(
    name: K,
    handler: EventHandler<TEvents[K]>,
  ): () => void {
    const set = this.handlers.get(name) ?? new Set();
    set.add(handler);
    this.handlers.set(name, set);
    return () => {
      set.delete(handler);
    };
  }
}
