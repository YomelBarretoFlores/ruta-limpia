import { sql } from 'kysely';

import { locateReferencePoints } from '../../../routes/domain/reference-points.js';
import { RI01_REFERENCE_POINTS, RI01_ROUTE } from '../../../routes/domain/ri01.fixture.js';
import { buildRouteGeometry } from '../../../routes/domain/route-geometry.js';
import type { AppDatabase } from './database.js';

export interface SeedOptions {
  /** Traccar identifier (IMEI or simulator id) of the pilot truck. */
  readonly vehicleUniqueId: string;
}

export interface SeedResult {
  readonly routeId: string;
  readonly vehicleId: string;
}

/** Reference points where the operators observe the music notice (Instrument 2). */
const MUSIC_OBSERVATION_POINTS = new Set(['P04', 'P08', 'P12']);

/** Sample "Inicio previsto": Monday to Saturday at 07:00 local time. */
const SAMPLE_SCHEDULE = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, plannedStart: '07:00' }));

/**
 * Seeds the pilot catalog: route RI-01 with P01–P15 (chainage and offset computed by the domain),
 * the truck UNIDAD-A and a sample schedule. Idempotent: rows are upserted by their natural keys,
 * and existing schedules are left as they are (operators may have edited them).
 */
export async function seedDatabase(db: AppDatabase, options: SeedOptions): Promise<SeedResult> {
  const geometry = buildRouteGeometry(RI01_ROUTE.polyline);
  const points = locateReferencePoints(geometry, RI01_REFERENCE_POINTS);
  const lineWkt = `SRID=4326;LINESTRING(${RI01_ROUTE.polyline.map((p) => `${p.lon} ${p.lat}`).join(', ')})`;

  return db.transaction().execute(async (trx) => {
    const route = await trx
      .insertInto('routes')
      .values({
        code: RI01_ROUTE.code,
        name: 'Av. Centenario – Independencia',
        district: 'Independencia',
        geometry: sql`ST_GeogFromText(${lineWkt})`,
        length_m: geometry.lengthMeters,
      })
      .onConflict((oc) =>
        oc.column('code').doUpdateSet((eb) => ({
          name: eb.ref('excluded.name'),
          district: eb.ref('excluded.district'),
          geometry: eb.ref('excluded.geometry'),
          length_m: eb.ref('excluded.length_m'),
        })),
      )
      .returning('id')
      .executeTakeFirstOrThrow();

    for (const point of points) {
      await trx
        .insertInto('reference_points')
        .values({
          route_id: route.id,
          code: point.code,
          name: point.name,
          sequence: point.sequence,
          location: sql`ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)::geography`,
          chainage_m: point.chainage,
          offset_m: point.offsetMeters,
          observes_music: MUSIC_OBSERVATION_POINTS.has(point.code),
        })
        .onConflict((oc) =>
          oc.columns(['route_id', 'code']).doUpdateSet((eb) => ({
            name: eb.ref('excluded.name'),
            sequence: eb.ref('excluded.sequence'),
            location: eb.ref('excluded.location'),
            chainage_m: eb.ref('excluded.chainage_m'),
            offset_m: eb.ref('excluded.offset_m'),
            observes_music: eb.ref('excluded.observes_music'),
          })),
        )
        .execute();
    }

    await trx
      .insertInto('route_schedules')
      .values(
        SAMPLE_SCHEDULE.map((s) => ({
          route_id: route.id,
          weekday: s.weekday,
          planned_start: s.plannedStart,
        })),
      )
      .onConflict((oc) => oc.columns(['route_id', 'weekday']).doNothing())
      .execute();

    const vehicle = await trx
      .insertInto('vehicles')
      .values({
        code: 'UNIDAD-A',
        label: 'Unidad A (compactadora)',
        traccar_unique_id: options.vehicleUniqueId,
        default_route_id: route.id,
      })
      .onConflict((oc) =>
        oc.column('code').doUpdateSet((eb) => ({
          traccar_unique_id: eb.ref('excluded.traccar_unique_id'),
          default_route_id: eb.ref('excluded.default_route_id'),
        })),
      )
      .returning('id')
      .executeTakeFirstOrThrow();

    return { routeId: route.id, vehicleId: vehicle.id };
  });
}
