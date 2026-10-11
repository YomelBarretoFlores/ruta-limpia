import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../../app.js';
import type { UsageRecorder } from './usage-routes.js';

describe('POST /api/usage/views', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it('limits each client IP to ten times the public mutation limit per minute', async () => {
    const record = vi.fn<UsageRecorder['record']>(() => Promise.resolve('recorded'));
    app = await buildApp({ usage: { views: { record }, mutationsPerMinute: 2 } });
    const view = (remoteAddress: string) =>
      app!.inject({
        method: 'POST',
        url: '/api/usage/views',
        payload: { pointCode: 'P08' },
        remoteAddress,
      });

    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await view('10.0.0.1')).statusCode);
    const otherClient = await view('10.0.0.2');

    expect(statuses.slice(0, 20)).toEqual(Array<number>(20).fill(204));
    expect(statuses[20]).toBe(429);
    expect(otherClient.statusCode).toBe(204);
    expect(record).toHaveBeenCalledTimes(21);
  });
});
