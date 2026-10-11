import type { ServerResponse } from 'node:http';

import type { EventBus } from '../../../shared/application/event-bus.js';
import type { Logger } from '../../../shared/application/logger.js';
import type { TrackingEvents } from '../../../tracking/application/tracking-events.js';
import {
  STREAMED_EVENTS,
  toLiveStreamEvent,
  type LiveStreamEvent,
  type StreamedRoute,
} from '../../application/live-event-views.js';
import { formatSseEvent, formatSseRetry, SSE_HEARTBEAT } from './sse-format.js';

export interface LiveStreamHubOptions {
  readonly events: EventBus<TrackingEvents>;
  /** Open streams across all routes; further requests get 503. */
  readonly maxConnections: number;
  /** A heartbeat comment is sent this often (proxies drop idle connections). */
  readonly heartbeatMs: number;
  /** `EventSource` reconnects after this delay when the stream drops. */
  readonly retryMs: number;
  readonly logger: Logger;
}

/** A slow client whose unsent output exceeds this is disconnected (it reconnects and resyncs). */
const MAX_BUFFERED_BYTES = 1024 * 1024;

/**
 * Open Server-Sent Events streams of the live routes. Each stream forwards the tracking events of
 * its route as public views; the hub caps the number of streams and closes them all on shutdown.
 */
export class LiveStreamHub {
  private readonly open = new Set<() => void>();

  constructor(private readonly options: LiveStreamHubOptions) {}

  get size(): number {
    return this.open.size;
  }

  /** False when the hub is full: the caller answers 503. */
  hasCapacity(): boolean {
    return this.open.size < this.options.maxConnections;
  }

  /**
   * Streams the route to an already hijacked response: headers, then the `snapshot` event built
   * by `snapshot()`, then every relevant tracking event. Events published while the snapshot is
   * built are queued and sent right after it, so none is lost. Resolves once the stream is set up.
   */
  async stream(
    response: ServerResponse,
    route: StreamedRoute,
    snapshot: () => Promise<object>,
  ): Promise<void> {
    const { events, logger } = this.options;
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write(formatSseRetry(this.options.retryMs));

    const write = (chunk: string): void => {
      if (response.destroyed || response.writableEnded) return;
      response.write(chunk);
      if (response.writableLength > MAX_BUFFERED_BYTES) {
        logger.warn({ routeId: route.id }, 'Live stream client too slow; disconnected');
        response.destroy();
      }
    };
    let queue: LiveStreamEvent[] | null = [];
    const send = (event: LiveStreamEvent): void => {
      if (queue === null) write(formatSseEvent(event.event, event.data));
      else queue.push(event);
    };

    const unsubscribes = STREAMED_EVENTS.map((name) =>
      events.subscribe(name, (payload: TrackingEvents[typeof name]) => {
        const event = toLiveStreamEvent(name, payload, route);
        if (event !== null) send(event);
      }),
    );
    const heartbeat = setInterval(() => write(SSE_HEARTBEAT), this.options.heartbeatMs);
    heartbeat.unref();

    const close = (): void => {
      if (!this.open.delete(close)) return;
      for (const unsubscribe of unsubscribes) unsubscribe();
      clearInterval(heartbeat);
      if (!response.writableEnded) response.end();
    };
    this.open.add(close);
    // The response closes when the client disconnects (or the stream ends): release everything.
    response.once('close', close);
    response.once('error', close);

    try {
      write(formatSseEvent('snapshot', await snapshot()));
    } catch (error) {
      logger.error({ err: error, routeId: route.id }, 'Live stream snapshot failed');
      close();
      return;
    }
    const pending = queue;
    queue = null;
    for (const event of pending) send(event);
  }

  /** Ends every open stream (graceful shutdown: lets the HTTP server close). */
  closeAll(): void {
    for (const close of [...this.open]) close();
  }
}
