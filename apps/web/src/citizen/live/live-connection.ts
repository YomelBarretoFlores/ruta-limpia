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

  const refresh = async () => {
    try {
      const snapshot = await fetchSnapshot();
      if (!closed) dispatch({ type: 'snapshot', snapshot });
    } catch {
      // The next poll, event or reconnection tries again.
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
      failures = 0;
      stopPolling();
      dispatch({ type: 'snapshot', snapshot: parse<LiveSnapshot>(event) });
      dispatch({ type: 'connection', status: 'live' });
    });
    for (const name of APPLIED_EVENTS) {
      stream.addEventListener(name, (event) => {
        dispatch({
          type: 'event',
          name,
          data: parse<LiveStreamEvents[typeof name]>(event),
        } as LiveAction);
      });
    }
    // A new trip: the snapshot carries its vehicle and progress.
    stream.addEventListener('trip.started', () => void refresh());

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

function parse<T>(event: MessageEvent<string>): T {
  return JSON.parse(event.data) as T;
}
