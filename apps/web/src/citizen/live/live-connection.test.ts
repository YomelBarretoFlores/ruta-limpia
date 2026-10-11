import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { snapshot } from '../test/fixtures';
import { connectLive, type EventSourceLike } from './live-connection';
import type { LiveAction } from './live-state';

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  emit(type: string, data: unknown) {
    this.readyState = 1;
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  fail(readyState: 0 | 2) {
    this.readyState = readyState;
    this.onerror?.(new Event('error'));
  }
}

const latest = () => FakeEventSource.instances[FakeEventSource.instances.length - 1]!;

function start() {
  const actions: LiveAction[] = [];
  const fetchSnapshot = vi.fn(() => Promise.resolve(snapshot([])));
  const close = connectLive({
    streamUrl: '/api/live/routes/RI-01/stream',
    fetchSnapshot,
    createEventSource: (url) => new FakeEventSource(url),
    dispatch: (action) => actions.push(action),
  });
  const statuses = () => actions.flatMap((a) => (a.type === 'connection' ? [a.status] : []));
  return { actions, fetchSnapshot, close, statuses };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('connectLive', () => {
  it('applies the snapshot and the stream events, and refetches on trip.started', async () => {
    const { actions, fetchSnapshot, statuses } = start();

    latest().emit('snapshot', snapshot());
    latest().emit('trip.completed', {
      tripId: 'trip-1',
      status: 'completed',
      endedAt: 'x',
      endReason: null,
    });
    latest().emit('trip.started', { tripId: 'trip-2', startedAt: 'x', startMode: 'auto' });
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledOnce());

    expect(latest().url).toBe('/api/live/routes/RI-01/stream');
    expect(statuses()).toEqual(['live']);
    expect(actions.map((a) => (a.type === 'event' ? a.name : a.type))).toEqual([
      'snapshot',
      'connection',
      'trip.completed',
      'snapshot',
    ]);
  });

  it('reports reconnecting while the browser retries, and reopens a closed stream', () => {
    const { statuses } = start();
    latest().emit('snapshot', snapshot());

    latest().fail(0);
    expect(statuses()).toEqual(['live', 'reconnecting']);
    expect(FakeEventSource.instances).toHaveLength(1);

    latest().fail(2);
    vi.advanceTimersByTime(5_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    latest().emit('snapshot', snapshot());
    expect(statuses()).toEqual(['live', 'reconnecting', 'reconnecting', 'live']);
  });

  it('polls every 30 s after repeated stream failures and returns to the stream later', async () => {
    const { fetchSnapshot, statuses } = start();

    latest().fail(2);
    vi.advanceTimersByTime(5_000);
    latest().fail(2);
    vi.advanceTimersByTime(5_000);
    latest().fail(2);

    expect(statuses()).toEqual(['reconnecting', 'reconnecting', 'polling']);
    expect(latest().closed).toBe(true);
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5 * 60_000 - 30_000);
    expect(FakeEventSource.instances).toHaveLength(4);
    latest().emit('snapshot', snapshot());
    const calls = fetchSnapshot.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(calls);
    expect(statuses().at(-1)).toBe('live');
  });

  it('polls from the start without EventSource and stops everything on close', async () => {
    const actions: LiveAction[] = [];
    const fetchSnapshot = vi.fn(() => Promise.resolve(snapshot([])));
    const close = connectLive({
      streamUrl: '/stream',
      fetchSnapshot,
      createEventSource: null,
      dispatch: (action) => actions.push(action),
    });
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledOnce());

    close();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(fetchSnapshot).toHaveBeenCalledOnce();
    expect(actions[0]).toEqual({ type: 'connection', status: 'polling' });
  });
});
