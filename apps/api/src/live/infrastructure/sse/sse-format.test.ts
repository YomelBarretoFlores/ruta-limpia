import { describe, expect, it } from 'vitest';

import { formatSseEvent, formatSseRetry, SSE_HEARTBEAT } from './sse-format.js';

describe('SSE format', () => {
  it('writes an event as one event line and one JSON data line', () => {
    expect(formatSseEvent('eta.updated', { tripId: 't-1', note: 'a\nb' })).toBe(
      'event: eta.updated\ndata: {"tripId":"t-1","note":"a\\nb"}\n\n',
    );
  });

  it('writes heartbeats as comments and the reconnection delay as retry', () => {
    expect(SSE_HEARTBEAT).toBe(': heartbeat\n\n');
    expect(formatSseRetry(5000)).toBe('retry: 5000\n\n');
  });
});
