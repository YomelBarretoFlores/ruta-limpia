import type { EventBus } from '../../shared/application/event-bus.js';
import type { PendingEvent, TrackingEventName, TrackingEvents } from './tracking-events.js';

/** Publishes events collected during a transaction, in order, after it committed. */
export function publishAll(bus: EventBus<TrackingEvents>, events: readonly PendingEvent[]): void {
  for (const event of events) publishOne(bus, event);
}

function publishOne<K extends TrackingEventName>(
  bus: EventBus<TrackingEvents>,
  event: { readonly name: K; readonly payload: TrackingEvents[K] },
): void {
  bus.publish(event.name, event.payload);
}
