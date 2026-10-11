import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

import type {
  IngestPositionCommand,
  IngestResult,
} from '../../application/ingest-position-service.js';
import { ingestTokenMatches } from './ingest-token.js';
import { toIngestCommand, traccarForwardSchema } from './traccar-payload.js';

export const INGEST_TOKEN_HEADER = 'x-ingest-token';

export interface PositionIngestor {
  ingest(command: IngestPositionCommand): Promise<IngestResult>;
}

export interface TraccarIngestRoutesOptions {
  readonly ingestToken: string;
  readonly ingestor: PositionIngestor;
}

/**
 * `POST /ingest/traccar/positions`: Traccar's JSON position forwarding.
 *
 * - 401 without the shared `X-Ingest-Token` (checked before the body is parsed);
 * - 400 for a malformed payload;
 * - 202 for an unknown device: accepted and logged, so Traccar does not retry it forever;
 * - 200 when processed, and for a replayed position (idempotent no-op);
 * - 5xx on processing errors, so Traccar retries (forward retry is enabled).
 */
export const traccarIngestRoutes: FastifyPluginCallback<TraccarIngestRoutesOptions> = (
  app,
  options,
  done,
) => {
  app.addHook('onRequest', (request, reply, next) => {
    if (!ingestTokenMatches(request.headers[INGEST_TOKEN_HEADER], options.ingestToken)) {
      request.log.warn({ ip: request.ip }, 'Ingest request rejected: invalid token');
      void reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    next();
  });

  app.post('/ingest/traccar/positions', async (request, reply) => {
    const parsed = traccarForwardSchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.warn({ issues: z.flattenError(parsed.error) }, 'Malformed Traccar payload');
      return reply
        .code(400)
        .send({ error: 'invalid_payload', details: z.prettifyError(parsed.error) });
    }

    const result = await options.ingestor.ingest(toIngestCommand(parsed.data));
    switch (result.status) {
      case 'processed':
        return reply.code(200).send({ status: 'processed', tripId: result.tripId });
      case 'duplicate':
        return reply.code(200).send({ status: 'duplicate' });
      case 'unknown_device':
        return reply.code(202).send({ status: 'ignored', reason: 'unknown_device' });
    }
  });

  done();
};
