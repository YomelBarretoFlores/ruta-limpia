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
}

/** Fetches a `trip.started` refetch may take when stream data keeps overtaking it. */
const TRIP_STARTED_FETCHES = 3;

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
  } = options;
  let closed = false;
  let source: EventSourceLike | null = null;
  let failures = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Counts the stream messages applied. A fetched snapshot is applied only when no stream data
   * arrived while it was in flight: otherwise it may be older than what the page already shows
   * (a trip that ended meanwhile would come back as a ghost, a slow poll would undo a fresher
   * stream snapshot).
   */
  let generation = 0;

  const applyStream = (action: LiveAction) => {
    generation += 1;
    dispatch(action);
  };

  /** Fetches the snapshot; when stream data overtakes it, fetches again up to `attempts` times. */
  const refresh = async (attempts = 1) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const seen = generation;
      try {
        const snapshot = await fetchSnapshot();
        if (closed) return;
        if (generation === seen) {
          dispatch({ type: 'snapshot', snapshot });
          return;
        }
      } catch {
        // The next poll, event or reconnection tries again.
        return;
      }
    }
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
    // A new trip: the snapshot carries its vehicle and progress.
    stream.addEventListener('trip.started', () => void refresh(TRIP_STARTED_FETCHES));

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
