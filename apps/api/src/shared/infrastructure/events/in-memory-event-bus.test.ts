import { describe, expect, it, vi } from 'vitest';

import { SILENT_LOGGER } from '../../application/logger.js';
import { InMemoryEventBus } from './in-memory-event-bus.js';

interface TestEvents {
  ping: { n: number };
  other: string;
}

describe('InMemoryEventBus', () => {
  it('delivers payloads to the handlers of that event until they unsubscribe', () => {
    const bus = new InMemoryEventBus<TestEvents>(SILENT_LOGGER);
    const received: number[] = [];
    const other = vi.fn();
    const unsubscribe = bus.subscribe('ping', (payload) => received.push(payload.n));
    bus.subscribe('other', other);

    bus.publish('ping', { n: 1 });
    unsubscribe();
    bus.publish('ping', { n: 2 });

    expect(received).toEqual([1]);
    expect(other).not.toHaveBeenCalled();
  });

  it('isolates a failing handler from the publisher and the other handlers', () => {
    const logger = { ...SILENT_LOGGER, error: vi.fn() };
    const bus = new InMemoryEventBus<TestEvents>(logger);
    const healthy = vi.fn();
    bus.subscribe('ping', () => {
      throw new Error('boom');
    });
    bus.subscribe('ping', healthy);

    expect(() => bus.publish('ping', { n: 1 })).not.toThrow();
    expect(healthy).toHaveBeenCalledWith({ n: 1 });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
