import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IngestResult } from '../../application/ingest-position-service.js';
import { traccarIngestRoutes } from './traccar-ingest-routes.js';
import { sampleForward } from '../../../../test/support/traccar-forward.js';

const token = 't'.repeat(64);

async function buildWith(ingest: () => Promise<IngestResult>) {
  const app = Fastify();
  const ingestor = { ingest: vi.fn(ingest) };
  await app.register(traccarIngestRoutes, { ingestToken: token, ingestor });
  return { app, ingestor };
}

const post = (app: FastifyInstance, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/ingest/traccar/positions',
    headers: { 'x-ingest-token': token, ...headers },
    payload: body as object,
  });

describe('POST /ingest/traccar/positions', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it('returns 401 without a valid token, before looking at the body', async () => {
    const built = await buildWith(() => Promise.resolve({ status: 'duplicate' }));
    app = built.app;

    const missing = await app.inject({
      method: 'POST',
      url: '/ingest/traccar/positions',
      payload: 'not json',
      headers: { 'content-type': 'application/json' },
    });
    const wrong = await post(app, sampleForward, { 'x-ingest-token': 'nope' });

    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(built.ingestor.ingest).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed payload', async () => {
    ({ app } = await buildWith(() => Promise.resolve({ status: 'duplicate' })));

    const response = await post(app, { position: { id: 'x' } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_payload' });
  });

  it.each([
    [{ status: 'processed', positionId: '1', tripId: null } as const, 200],
    [{ status: 'duplicate' } as const, 200],
    [{ status: 'unknown_device' } as const, 202],
    [{ status: 'future_fix' } as const, 202],
  ])('maps %o to HTTP %i', async (result, statusCode) => {
    ({ app } = await buildWith(() => Promise.resolve(result)));

    expect((await post(app, sampleForward)).statusCode).toBe(statusCode);
  });

  it('accepts a fix dated in the future without processing it, so Traccar does not retry', async () => {
    ({ app } = await buildWith(() => Promise.resolve({ status: 'future_fix' })));

    expect((await post(app, sampleForward)).json()).toEqual({
      status: 'ignored',
      reason: 'future_fix',
    });
  });

  it('answers 5xx when processing fails, so Traccar retries', async () => {
    ({ app } = await buildWith(() => Promise.reject(new Error('database unavailable'))));

    expect((await post(app, sampleForward)).statusCode).toBe(500);
  });
});
