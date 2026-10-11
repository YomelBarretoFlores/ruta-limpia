/**
 * Server-Sent Events wire format (WHATWG HTML, "server-sent events"). JSON data never contains a
 * raw line break, so each event is a single `data:` line.
 */
export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A comment line: ignored by `EventSource`, but keeps proxies and NAT from closing an idle stream. */
export const SSE_HEARTBEAT = ': heartbeat\n\n';

/** Tells `EventSource` how long to wait before reconnecting after the stream drops. */
export function formatSseRetry(ms: number): string {
  return `retry: ${ms}\n\n`;
}
