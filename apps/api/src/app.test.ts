import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { HealthResponse } from './shared/infrastructure/http/health-routes.js';

describe('GET /health', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('reports the service as healthy', async () => {
    app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    const body = response.json<HealthResponse>();
    expect(body.status).toBe('ok');
    expect(body.uptimeSeconds).toBeTypeOf('number');
  });

  it('returns 404 for unknown routes', async () => {
    app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);
  });
});
