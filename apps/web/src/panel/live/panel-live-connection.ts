import type { EventSourceFactory, EventSourceLike } from '../../citizen/live/live-connection';

/** `live`: the stream is open; `reconnecting`: it dropped; `polling`: only the periodic refetch. */
export type PanelConnection = 'connecting' | 'live' | 'reconnecting' | 'polling';

/** The stream events after which the panel snapshot is fetched again. */
export const REFETCH_EVENTS = [
  'snapshot',
  'vehicle.position',
  'eta.updated',
  'point.passed',
  'trip.started',
  'trip.completed',
  'alert.emitted',
] as const;

export interface PanelLiveOptions {
  readonly streamUrl: string;
  readonly createEventSource: EventSourceFactory | null;
  /** Fetches the panel snapshot (with the pass table and delivery counts) again. */
  readonly refetch: () => void;
  readonly onConnection: (connection: PanelConnection) => void;
  /** Stream events closer than this are answered with one refetch (a busy route stays cheap). */
  readonly debounceMs?: number;
  /** The periodic refetch, which also keeps ages and stale signals current without events. */
  readonly pollIntervalMs?: number;
  /** Delay before reopening a stream the browser closed (for example after a 503). */
  readonly reconnectDelayMs?: number;
}

/** `EventSource.CLOSED`: the browser will not reconnect by itself. */
const CLOSED = 2;

/**
 * Keeps the live panel current: the public stream says when something changed (a fix, a pass,
 * an alert, a trip starting or ending) and the panel snapshot is fetched again, at most once per
 * `debounceMs`; a periodic refetch runs whatever the stream does. The stream carries no
 * delivery counts, so the panel never patches its table from events. Returns the close function.
 */
export function connectPanelLive(options: PanelLiveOptions): () => void {
  const {
    streamUrl,
    createEventSource,
    refetch,
    onConnection,
    debounceMs = 1_000,
    pollIntervalMs = 20_000,
    reconnectDelayMs = 5_000,
  } = options;
  let closed = false;
  let source: EventSourceLike | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let reopen: ReturnType<typeof setTimeout> | null = null;
  const poll = setInterval(refetch, pollIntervalMs);

  const scheduleRefetch = () => {
    if (pending !== null) return;
    pending = setTimeout(() => {
      pending = null;
      if (!closed) refetch();
    }, debounceMs);
  };

  const open = () => {
    if (createEventSource === null) {
      onConnection('polling');
      return;
    }
    const stream = createEventSource(streamUrl);
    source = stream;
    for (const name of REFETCH_EVENTS) {
      stream.addEventListener(name, () => {
        if (name === 'snapshot') onConnection('live');
        scheduleRefetch();
      });
    }
    stream.onerror = () => {
      if (closed || source !== stream) return;
      onConnection('reconnecting');
      if (stream.readyState === CLOSED) {
        reopen = setTimeout(() => {
          reopen = null;
          if (!closed) open();
        }, reconnectDelayMs);
      }
    };
  };

  open();
  return () => {
    closed = true;
    source?.close();
    clearInterval(poll);
    if (pending !== null) clearTimeout(pending);
    if (reopen !== null) clearTimeout(reopen);
  };
}
