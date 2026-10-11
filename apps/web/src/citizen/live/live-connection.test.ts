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
    this.emitRaw(type, JSON.stringify(data));
  }

  emitRaw(type: string, data: string) {
    this.readyState = 1;
    const event = new MessageEvent(type, { data });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  fail(readyState: 0 | 2) {
    this.readyState = readyState;
    this.onerror?.(new Event('error'));
  }
}

const latest = () => FakeEventSource.instances[FakeEventSource.instances.length - 1]!;

/** `random` is the jitter source of the refetch rounds: 1 (by default) waits the longest. */
function start(random: () => number = () => 1) {
  const actions: LiveAction[] = [];
  const fetchSnapshot = vi.fn(() => Promise.resolve(snapshot([])));
  const close = connectLive({
    streamUrl: '/api/live/routes/RI-01/stream',
    fetchSnapshot,
    createEventSource: (url) => new FakeEventSource(url),
    dispatch: (action) => actions.push(action),
    random,
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

  it('drops a fetched snapshot when stream data arrived while it was in flight, and fetches again', async () => {
    const { actions, fetchSnapshot } = start();
    latest().emit('snapshot', snapshot());
    // The first refetch is taken before the trip ends; the second one after.
    let answerFirst: (value: ReturnType<typeof snapshot>) => void = () => undefined;
    fetchSnapshot
      .mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)))
      .mockImplementationOnce(() => Promise.resolve(snapshot([])));

    latest().emit('trip.started', { tripId: 'trip-2', startedAt: 'x', startMode: 'auto' });
    latest().emit('trip.completed', {
      tripId: 'trip-1',
      status: 'completed',
      endedAt: 'x',
      endReason: null,
    });
    answerFirst(snapshot());
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(actions.at(-1)?.type).toBe('snapshot'));

    const snapshots = actions.filter((a) => a.type === 'snapshot');
    // The stream snapshot, then only the fresh refetch: the ghost of trip-1 never comes back.
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toEqual({ type: 'snapshot', snapshot: snapshot([]) });
  });

  it('lets a reopened stream win over a slow poll that finishes after it', async () => {
    const { actions, fetchSnapshot } = start();
    let answerPoll: (value: ReturnType<typeof snapshot>) => void = () => undefined;
    fetchSnapshot.mockImplementationOnce(() => new Promise((resolve) => (answerPoll = resolve)));
    latest().fail(2);
    vi.advanceTimersByTime(5_000);
    latest().fail(2);
    vi.advanceTimersByTime(5_000);
    latest().fail(2);
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    latest().emit('snapshot', snapshot([]));
    const streamSnapshotAt = actions.length - 2;
    answerPoll(snapshot());
    await vi.advanceTimersByTimeAsync(0);

    expect(actions[streamSnapshotAt]).toEqual({ type: 'snapshot', snapshot: snapshot([]) });
    // The first poll answered last, with the trip: it is not applied over the stream snapshot.
    expect(actions.slice(streamSnapshotAt + 1).filter((a) => a.type === 'snapshot')).toEqual([]);
  });

  it('skips a malformed event and keeps applying the next ones', () => {
    const { actions, statuses } = start();

    latest().emitRaw('snapshot', '{"route": ');
    latest().emit('snapshot', snapshot());
    latest().emitRaw('eta.updated', 'not json');
    latest().emit('trip.completed', {
      tripId: 'trip-1',
      status: 'completed',
      endedAt: 'x',
      endReason: null,
    });

    expect(statuses()).toEqual(['live']);
    expect(actions.map((a) => (a.type === 'event' ? a.name : a.type))).toEqual([
      'snapshot',
      'connection',
      'trip.completed',
    ]);
  });

  it('does not let events of the new trip, unknown to the page yet, discard its refetch', async () => {
    const { actions, fetchSnapshot } = start();
    latest().emit('snapshot', snapshot([]));
    let answer: (value: ReturnType<typeof snapshot>) => void = () => undefined;
    fetchSnapshot.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));

    latest().emit('trip.started', { tripId: 'trip-1', startedAt: 'x', startMode: 'auto' });
    // The new trip reports positions before its snapshot arrives; the state cannot use them yet.
    latest().emit('vehicle.position', {
      tripId: 'trip-1',
      vehicleCode: 'UNIDAD-A',
      fixTime: 'x',
      lat: -9.52,
      lon: -77.53,
      speedKmh: 12,
      course: 90,
    });
    answer(snapshot());
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchSnapshot).toHaveBeenCalledOnce();
    expect(actions.filter((a) => a.type === 'snapshot').at(-1)).toEqual({
      type: 'snapshot',
      snapshot: snapshot(),
    });
  });

  it('tries the trip.started refetch again later when every attempt was overtaken or failed', async () => {
    const { actions, fetchSnapshot } = start();
    latest().emit('snapshot', snapshot());
    const etaUpdate = {
      tripId: 'trip-1',
      computedAt: 'x',
      lastFixAt: 'x',
      signal: 'live',
      etas: [],
    };
    // Every attempt of the first round is overtaken by an update of the known trip.
    fetchSnapshot.mockImplementation(() => {
      latest().emit('eta.updated', etaUpdate);
      return Promise.resolve(snapshot());
    });
    latest().emit('trip.started', { tripId: 'trip-2', startedAt: 'x', startMode: 'auto' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSnapshot).toHaveBeenCalledTimes(3);
    const before = actions.filter((a) => a.type === 'snapshot').length;

    // The route calms down: the later round is applied.
    fetchSnapshot.mockImplementation(() => Promise.resolve(snapshot([])));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetchSnapshot).toHaveBeenCalledTimes(4);
    const snapshots = actions.filter((a) => a.type === 'snapshot');
    expect(snapshots).toHaveLength(before + 1);
    expect(snapshots.at(-1)).toEqual({ type: 'snapshot', snapshot: snapshot([]) });

    // A failed refetch is retried too.
    fetchSnapshot.mockImplementationOnce(() => Promise.reject(new TypeError('offline')));
    latest().emit('trip.started', { tripId: 'trip-3', startedAt: 'x', startMode: 'auto' });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(6);
  });

  it('spreads the refetch rounds with a growing, random delay so clients do not retry in step', async () => {
    const draws = [0.5, 0.25, 0.1, 1];
    const { fetchSnapshot } = start(() => draws.shift() ?? 1);
    latest().emit('snapshot', snapshot());
    fetchSnapshot.mockImplementation(() => Promise.reject(new TypeError('offline')));
    const callsAfter = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      return fetchSnapshot.mock.calls.length;
    };

    latest().emit('trip.started', { tripId: 'trip-2', startedAt: 'x', startMode: 'auto' });
    expect(await callsAfter(0)).toBe(1);
    // Round 2 after 0.5 × 5 s, round 3 after 0.25 × 10 s, round 4 after 0.1 × 20 s, round 5
    // after 1 × 40 s.
    expect([await callsAfter(2_499), await callsAfter(1)]).toEqual([1, 2]);
    expect([await callsAfter(2_499), await callsAfter(1)]).toEqual([2, 3]);
    expect([await callsAfter(1_999), await callsAfter(1)]).toEqual([3, 4]);
    expect([await callsAfter(39_999), await callsAfter(1)]).toEqual([4, 5]);
    // Five rounds at most.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(5);
  });

  it('lets a new trip.started replace the previous refetch chain, keeping the round cap', async () => {
    const { fetchSnapshot } = start();
    latest().emit('snapshot', snapshot());
    let rejectFirst: (error: Error) => void = () => undefined;
    fetchSnapshot.mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)));
    fetchSnapshot.mockImplementation(() => Promise.reject(new TypeError('offline')));

    // The first chain's fetch is still in flight when the second trip.started arrives.
    latest().emit('trip.started', { tripId: 'trip-2', startedAt: 'x', startMode: 'auto' });
    latest().emit('trip.started', { tripId: 'trip-3', startedAt: 'x', startMode: 'auto' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    // Its failure, arriving late, schedules nothing: only the second chain goes on.
    rejectFirst(new TypeError('offline'));
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    // One fetch of the old chain, then five rounds of one fetch each for the new one.
    expect(fetchSnapshot).toHaveBeenCalledTimes(1 + 5);
  });
});
