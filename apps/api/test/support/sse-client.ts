/** One parsed Server-Sent Event (`data` is parsed as JSON). */
export interface SseMessage {
  readonly event: string;
  readonly data: unknown;
}

export interface SseConnection {
  readonly status: number;
  readonly headers: Headers;
  /** Comment lines received so far (heartbeats), without the leading colon. */
  readonly comments: string[];
  /** `retry:` values received so far. */
  readonly retries: number[];
  /** Waits for the next event matching `predicate` (events before it are consumed). */
  next(predicate?: (message: SseMessage) => boolean, timeoutMs?: number): Promise<SseMessage>;
  /** Resolves when the server ends the stream. */
  readonly ended: Promise<void>;
  close(): void;
}

/** A minimal `EventSource` for tests, over `fetch`. */
export async function openSse(url: string): Promise<SseConnection> {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const received: SseMessage[] = [];
  const comments: string[] = [];
  const retries: number[] = [];
  let wake: () => void = () => undefined;
  let done = false;

  const ended = (async () => {
    if (response.body === null) return;
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += value;
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          parseBlock(buffer.slice(0, end), received, comments, retries);
          buffer = buffer.slice(end + 2);
        }
        wake();
      }
    } catch {
      // aborted by close()
    } finally {
      done = true;
      wake();
    }
  })();

  return {
    status: response.status,
    headers: response.headers,
    comments,
    retries,
    ended,
    close: () => controller.abort(),
    async next(predicate = () => true, timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        while (received.length > 0) {
          const message = received.shift()!;
          if (predicate(message)) return message;
        }
        if (done) throw new Error('SSE stream ended before the expected event');
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Timed out waiting for an SSE event');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, remaining);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    },
  };
}

function parseBlock(block: string, events: SseMessage[], comments: string[], retries: number[]) {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) comments.push(line.slice(1).trim());
    else if (line.startsWith('event: ')) event = line.slice(7);
    else if (line.startsWith('data: ')) data.push(line.slice(6));
    else if (line.startsWith('retry: ')) retries.push(Number(line.slice(7)));
  }
  if (data.length > 0) events.push({ event, data: JSON.parse(data.join('\n')) as unknown });
}
