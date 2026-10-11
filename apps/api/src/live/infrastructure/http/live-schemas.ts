import { z } from 'zod';

/**
 * Response schemas of the public live API. Every response is parsed through them before it is
 * sent: unknown keys are stripped, so internal data (subscription ids, tokens, vehicle ids) cannot
 * leak, and a `stale` ETA cannot carry a prediction.
 */

const isoDate = z.iso.datetime();

export const etaViewSchema = z.discriminatedUnion('status', [
  z.object({
    pointId: z.string(),
    pointCode: z.string(),
    status: z.literal('live'),
    predictedPassAt: isoDate,
    secondsRemaining: z.number().int().nonnegative(),
    window: z.object({
      minMinutes: z.number().int().nonnegative(),
      maxMinutes: z.number().int().positive(),
    }),
  }),
  z.strictObject({
    pointId: z.string(),
    pointCode: z.string(),
    status: z.enum(['stale', 'passed', 'not_started']),
  }),
]);

export const passViewSchema = z.object({
  pointId: z.string(),
  pointCode: z.string(),
  passedAt: isoDate,
  precision: z.enum(['interpolated', 'upper_bound']),
});

export const alertViewSchema = z.object({
  pointId: z.string(),
  pointCode: z.string(),
  emittedAt: isoDate,
  communicatedPredictedPassAt: isoDate,
  recipients: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
});

export const signalSchema = z.enum(['live', 'stale', 'none']);

export const liveTripViewSchema = z.object({
  tripId: z.string(),
  startedAt: isoDate,
  startMode: z.enum(['auto', 'manual']),
  vehicle: z.object({ code: z.string(), label: z.string() }),
  signal: signalSchema,
  lastFixAt: isoDate.nullable(),
  lastPosition: z.object({ lat: z.number(), lon: z.number(), fixTime: isoDate }).nullable(),
  progress: z.object({
    chainageMeters: z.number().nonnegative(),
    percent: z.number().min(0).max(100),
    offRoute: z.boolean(),
  }),
  etas: z.array(etaViewSchema),
  passes: z.array(passViewSchema),
  alerts: z.array(alertViewSchema),
});

/** `GET /api/live/routes/:code` response, also the `snapshot` event of the stream. */
export const liveSnapshotResponseSchema = z.object({
  route: z.object({ code: z.string(), name: z.string() }),
  generatedAt: isoDate,
  staleAfterSeconds: z.number().int().positive(),
  trips: z.array(liveTripViewSchema),
});

export type LiveSnapshotResponse = z.infer<typeof liveSnapshotResponseSchema>;
