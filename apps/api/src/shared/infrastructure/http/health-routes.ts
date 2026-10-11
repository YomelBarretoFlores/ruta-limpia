import type { FastifyPluginCallback } from 'fastify';

export interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
}

/** Liveness probe used by Docker healthchecks, the reverse proxy and uptime monitoring. */
export const healthRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get<{ Reply: HealthResponse }>(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            required: ['status', 'uptimeSeconds'],
            properties: {
              status: { type: 'string', const: 'ok' },
              uptimeSeconds: { type: 'number' },
            },
          },
        },
      },
    },
    (_request, reply) => {
      reply.send({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
    },
  );
  done();
};
