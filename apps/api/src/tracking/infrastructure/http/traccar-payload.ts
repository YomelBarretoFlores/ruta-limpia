import { z } from 'zod';

import { knotsToKmh } from '../../domain/position-fix.js';
import type { IngestPositionCommand } from '../../application/ingest-position-service.js';

/** Traccar serializes dates as ISO 8601 strings; epoch milliseconds are accepted too. */
const timestamp = z.union([z.string().min(1), z.number()]).transform((value, ctx) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'Invalid date' });
    return z.NEVER;
  }
  return date;
});

/**
 * The JSON body of Traccar's position forwarding (`forward.type=json`): `{ position, device }`.
 * Only the fields the pipeline needs are validated; unknown fields (attributes, network, ...) are
 * ignored. Speed is in knots.
 */
export const traccarForwardSchema = z.object({
  position: z.object({
    id: z.number().int().positive(),
    deviceId: z.number().int(),
    fixTime: timestamp,
    serverTime: timestamp.nullish(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    speed: z.number().min(0),
    course: z.number().nullish(),
    valid: z.boolean(),
    accuracy: z.number().nullish(),
  }),
  device: z.object({
    uniqueId: z.string().min(1),
    name: z.string().nullish(),
  }),
});

export type TraccarForward = z.infer<typeof traccarForwardSchema>;

export function toIngestCommand(payload: TraccarForward): IngestPositionCommand {
  const { position, device } = payload;
  return {
    traccarPositionId: position.id,
    deviceUniqueId: device.uniqueId,
    fixTime: position.fixTime,
    serverTime: position.serverTime ?? null,
    lat: position.latitude,
    lon: position.longitude,
    speedKmh: knotsToKmh(position.speed),
    course: position.course ?? null,
    valid: position.valid,
    accuracy: position.accuracy ?? null,
  };
}
