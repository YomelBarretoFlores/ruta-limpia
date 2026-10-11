import { describe, expect, it, vi } from 'vitest';

import { requestJson, type FetchLike } from './http';

function capture() {
  const fetchFn = vi.fn<FetchLike>(() => Promise.resolve(Response.json({ ok: true })));
  const headersOf = () => new Headers(fetchFn.mock.calls[0]?.[1]?.headers);
  return { fetchFn, headersOf };
}

describe('requestJson', () => {
  it('keeps the headers of a Headers instance', async () => {
    const { fetchFn, headersOf } = capture();

    await requestJson(fetchFn, '/x', { headers: new Headers({ authorization: 'Bearer t' }) });

    expect(headersOf().get('authorization')).toBe('Bearer t');
    expect(headersOf().get('accept')).toBe('application/json');
  });

  it('keeps the headers given as pairs, and lets the caller override the defaults', async () => {
    const { fetchFn, headersOf } = capture();

    await requestJson(fetchFn, '/x', {
      method: 'POST',
      body: '{}',
      headers: [
        ['authorization', 'Bearer t'],
        ['accept', 'application/problem+json'],
      ],
    });

    expect(headersOf().get('authorization')).toBe('Bearer t');
    expect(headersOf().get('accept')).toBe('application/problem+json');
    expect(headersOf().get('content-type')).toBe('application/json');
  });
});
