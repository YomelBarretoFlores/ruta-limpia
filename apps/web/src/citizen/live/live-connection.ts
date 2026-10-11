import type { LiveSnapshot, LiveStreamEvents } from '../api/types';
import type { AppliedEventName, LiveAction } from './live-state';

/** The part of `EventSource` the connection uses (tests pass a fake). */
export interface EventSourceLike {
  readonly readyState: number;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

/** `EventSource.CLOSED`: the browser gave up (for example a 503); it will not reconnect alone. */
const CLOSED = 2;

const APPLIED_EVENTS: readonly AppliedEventName[] = [
  'vehicle.position',
  'eta.updated',
  'point.passed',
  'trip.completed',
];

export interface LiveConnectionOptions {
  readonly streamUrl: string;
  readonly fetchSnapshot: () => Promise<LiveSnapshot>;
  /** Null when the browser has no `EventSource`: the connection polls from the start. */
  readonly createEventSource: EventSourceFactory | null;
  readonly dispatch: (action: LiveAction) => void;
  /** Stream errors in a row (without a snapshot in between) before falling back to polling. */
  readonly maxStreamFailures?: number;
  readonly pollIntervalMs?: number;
  /** Delay before reopening a stream the browser closed. */
  readonly reconnectDelayMs?: number;
  /** While polling, the stream is tried again after this delay. */
  readonly streamRetryMs?: number;
  /**
   * The base delay of the later rounds of a `trip.started` refetch that failed or was always
   * overtaken: round n waits a random time up to `refetchRetryMs × 2^(n−1)` (full jitter).
   */
  readonly refetchRetryMs?: number;
  /** The jitter source, in [0, 1) (tests pass a fixed one). */
  readonly random?: () => number;
}

/** Fetches a `trip.started` refetch may take when stream data keeps overtaking it. */
const TRIP_STARTED_FETCHES = 3;
/** Later rounds of a `trip.started` refetch that failed or was always overtaken. */
const TRIP_STARTED_ROUNDS = 5;

/** Stream events about one trip: the state ignores them while it does not know the trip. */
const TRIP_EVENTS: ReadonlySet<string> = new Set([
  'vehicle.position',
  'eta.updated',
  'point.passed',
]);

/**
 * Keeps the live state of a route up to date: Server-Sent Events first (the `snapshot` event,
 * then every change), reconnecting when the stream drops. After `maxStreamFailures` errors in a
 * row it polls the snapshot every `pollIntervalMs` and tries the stream again later.
 * Returns a function that closes everything.
 */
export function connectLive(options: LiveConnectionOptions): () => void {
  const {
    streamUrl,
    fetchSnapshot,
    createEventSource,
    dispatch,
    maxStreamFailures = 3,
    pollIntervalMs = 30_000,
    reconnectDelayMs = 5_000,
    streamRetryMs = 5 * 60_000,
    refetchRetryMs = 5_000,
    random = Math.random,
  } = options;
  let closed = false;
  let source: EventSourceLike | null = null;
  let failures = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let refetchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Counts `trip.started` refetch chains: only the latest one may schedule a later round. */
  let refetchChain = 0;
  /** Trips of the last applied snapshot: events of other trips change nothing the page shows. */
  let knownTrips: ReadonlySet<string> = new Set();
  /**
   * Counts the stream messages applied. A fetched snapshot is applied only when no stream data
   * arrived while it was in flight: otherwise it may be older than what the page already shows
   * (a trip that ended meanwhile would come back as a ghost, a slow poll would undo a fresher
   * stream snapshot).
   */
  let generation = 0;

  const applySnapshot = (snapshot: LiveSnapshot) => {
    knownTrips = new Set(snapshot.trips.map((trip) => trip.tripId));
    dispatch({ type: 'snapshot', snapshot });
  };

  const applyStream = (action: LiveAction) => {
    // An event of a trip the page does not know yet (the new trip of a pending refetch) is
    // ignored by the state, so it cannot make a snapshot in flight outdated.
    const ignored =
      action.type === 'event' &&
      TRIP_EVENTS.has(action.name) &&
      !knownTrips.has(action.data.tripId);
    if (!ignored) generation += 1;
    if (action.type === 'snapshot') {
      applySnapshot(action.snapshot);
    } else {
      dispatch(action);
    }
  };

  /**
   * Fetches the snapshot; when stream data overtakes it, fetches again up to `attempts` times.
   * Resolves whether a snapshot was applied (false after a failure or when always overtaken).
   */
  const refresh = async (attempts = 1): Promise<boolean> => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const seen = generation;
      try {
        const snapshot = await fetchSnapshot();
        if (closed) return false;
        if (generation === seen) {
          applySnapshot(snapshot);
          return true;
        }
      } catch {
        // The next poll, event, reconnection or refetch round tries again.
        return false;
      }
    }
    return false;
  };

  /**
   * A new trip: the snapshot carries its vehicle and progress. A round that failed or was always
   * overtaken by a busy stream runs again later (a few times), so the new trip is not left out
   * while the stream stays open and nothing polls. Every page on the route gets `trip.started`
   * at the same moment, so the later rounds wait a random, growing delay: a struggling server is
   * not hit by every page again in step. A new `trip.started` replaces the running chain: the
   * rounds of the old one, even one still in flight, schedule nothing more.
   */
  const refetchForNewTrip = () => {
    if (refetchTimer !== null) clearTimeout(refetchTimer);
    refetchTimer = null;
    refetchChain += 1;
    runRefetchRound(refetchChain, 0);
  };

  const runRefetchRound = (chain: number, round: number) => {
    void refresh(TRIP_STARTED_FETCHES).then((applied) => {
      if (applied || closed || chain !== refetchChain || round + 1 >= TRIP_STARTED_ROUNDS) return;
      const delayMs = random() * refetchRetryMs * 2 ** round;
      refetchTimer = setTimeout(() => {
        refetchTimer = null;
        if (!closed && chain === refetchChain) runRefetchRound(chain, round + 1);
      }, delayMs);
    });
  };

  const stopPolling = () => {
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
  };

  const startPolling = () => {
    dispatch({ type: 'connection', status: 'polling' });
    if (pollTimer === null) {
      void refresh();
      pollTimer = setInterval(() => void refresh(), pollIntervalMs);
    }
    if (createEventSource !== null) schedule(openStream, streamRetryMs);
  };

  const schedule = (run: () => void, delayMs: number) => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!closed) run();
    }, delayMs);
  };

  function openStream() {
    if (createEventSource === null) return startPolling();
    source?.close();
    const stream = createEventSource(streamUrl);
    source = stream;

    stream.addEventListener('snapshot', (event) => {
      const snapshot = parse<LiveSnapshot>(event);
      if (snapshot === null) return;
      failures = 0;
      stopPolling();
      applyStream({ type: 'snapshot', snapshot });
      dispatch({ type: 'connection', status: 'live' });
    });
    for (const name of APPLIED_EVENTS) {
      stream.addEventListener(name, (event) => {
        const data = parse<LiveStreamEvents[typeof name]>(event);
        if (data === null) return;
        applyStream({ type: 'event', name, data } as LiveAction);
      });
    }
    stream.addEventListener('trip.started', () => refetchForNewTrip());

    stream.onerror = () => {
      if (closed || source !== stream) return;
      failures += 1;
      if (failures >= maxStreamFailures) {
        stream.close();
        source = null;
        startPolling();
        return;
      }
      dispatch({ type: 'connection', status: 'reconnecting' });
      // While CONNECTING the browser reconnects by itself (`retry: 5000`); once CLOSED it won't.
      if (stream.readyState === CLOSED) schedule(openStream, reconnectDelayMs);
    };
  }

  openStream();
  return () => {
    closed = true;
    source?.close();
    source = null;
    stopPolling();
    if (retryTimer !== null) clearTimeout(retryTimer);
    if (refetchTimer !== null) clearTimeout(refetchTimer);
  };
}

/** The event's JSON data, or null for a malformed or truncated payload (the event is skipped). */
function parse<T>(event: MessageEvent<string>): T | null {
  try {
    const data: unknown = JSON.parse(event.data);
    return typeof data === 'object' && data !== null ? (data as T) : null;
  } catch {
    return null;
  }
}
