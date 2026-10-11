import type { FastifyInstance } from 'fastify';

import type { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG } from './api-config.js';
import { ri01PositionAt } from './ri01-tracking.js';
import { forwardAt, sampleForward } from './traccar-forward.js';

export const DRIVE_VEHICLE_UNIQUE_ID = sampleForward.device.uniqueId;

export interface DriveFix {
  readonly seconds: number;
  readonly chainage: number;
  /** Shifts the fix east of the route (off route beyond 60 m). */
  readonly eastMeters?: number;
}

/**
 * Posts Traccar forwards of UNIDAD-A along RI-01 through the ingest endpoint, moving the clock to
 * each fix time first. Returns the next free Traccar position id.
 */
export async function driveRi01(
  app: FastifyInstance,
  clock: ManualClock,
  t0: number,
  fixes: readonly DriveFix[],
  firstId = 1,
): Promise<number> {
  let id = firstId;
  for (const fix of fixes) {
    clock.set(new Date(t0 + fix.seconds * 1000));
    const forward = forwardAt(t0, id++, fix.seconds, fix.chainage, DRIVE_VEHICLE_UNIQUE_ID);
    if (fix.eastMeters !== undefined) {
      const shifted = ri01PositionAt(fix.chainage, fix.eastMeters);
      forward.position.latitude = shifted.lat;
      forward.position.longitude = shifted.lon;
    }
    const response = await app.inject({
      method: 'POST',
      url: '/ingest/traccar/positions',
      headers: { 'x-ingest-token': TEST_API_CONFIG.ingestToken },
      payload: forward,
    });
    if (response.statusCode !== 200) {
      throw new Error(`Ingest answered ${response.statusCode}: ${response.body}`);
    }
  }
  return id;
}
