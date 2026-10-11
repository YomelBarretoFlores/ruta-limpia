import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventSourceLike } from '../../citizen/live/live-connection';
import { connectPanelLive, type PanelConnection } from './panel-live-connection';

class FakeStream implements EventSourceLike {
  readyState = 0;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string) {
    this.readyState = 1;
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type));
  }
}

let streams: FakeStream[];
beforeEach(() => {
  vi.useFakeTimers();
  streams = [];
});
afterEach(() => vi.useRealTimers());

function start() {
  const refetch = vi.fn();
  const connections: PanelConnection[] = [];
  const close = connectPanelLive({
    streamUrl: '/api/live/routes/RI-01/stream',
    createEventSource: () => {
      const stream = new FakeStream();
      streams.push(stream);
      return stream;
    },
    refetch,
    onConnection: (c) => connections.push(c),
  });
  return { refetch, connections, close };
}

describe('connectPanelLive', () => {
  it('refetches once after a burst of stream events', () => {
    const { refetch, connections } = start();

    streams[0]!.emit('snapshot');
    streams[0]!.emit('vehicle.position');
    streams[0]!.emit('alert.emitted');
    vi.advanceTimersByTime(1_000);

    expect(connections).toEqual(['live']);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('refetches periodically even without events, and stops when closed', () => {
    const { refetch, close } = start();

    vi.advanceTimersByTime(40_000);
    expect(refetch).toHaveBeenCalledTimes(2);

    close();
    streams[0]!.emit('point.passed');
    vi.advanceTimersByTime(60_000);
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(streams[0]!.closed).toBe(true);
  });

  it('polls only, on the interval, when the browser has no EventSource', () => {
    const refetch = vi.fn();
    const connections: PanelConnection[] = [];
    connectPanelLive({
      streamUrl: '/api/live/routes/RI-01/stream',
      createEventSource: null,
      refetch,
      onConnection: (c) => connections.push(c),
    });

    expect(connections).toEqual(['polling']);
    vi.advanceTimersByTime(19_999);
    expect(refetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('leaves the reconnection to the browser while the stream is still connecting', () => {
    const { connections } = start();
    streams[0]!.readyState = 0;
    streams[0]!.onerror?.(new Event('error'));

    vi.advanceTimersByTime(60_000);

    expect(connections).toEqual(['reconnecting']);
    expect(streams).toHaveLength(1);
    streams[0]!.emit('snapshot');
    expect(connections).toEqual(['reconnecting', 'live']);
  });

  it('reopens a stream the browser closed', () => {
    const { connections } = start();
    streams[0]!.readyState = 2;
    streams[0]!.onerror?.(new Event('error'));

    vi.advanceTimersByTime(5_000);

    expect(connections).toEqual(['reconnecting']);
    expect(streams).toHaveLength(2);
  });
});
