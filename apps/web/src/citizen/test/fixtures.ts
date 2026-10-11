import type { LiveSnapshot, LiveTrip, PointEta, RouteDetail } from '../api/types';

/** A short RI-01 like route for the tests. */
export const ROUTE: RouteDetail = {
  code: 'RI-01',
  name: 'Av. Centenario – Independencia',
  district: 'Independencia',
  lengthMeters: 1285.8,
  pointCount: 3,
  timeZone: 'America/Lima',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-77.52855, -9.523468],
      [-77.5279, -9.5241],
      [-77.5271, -9.5249],
    ],
  },
  points: [
    {
      code: 'P01',
      name: 'Esquina Centenario',
      sequence: 1,
      lat: -9.5232,
      lon: -77.5286,
      chainageMeters: 30,
      observesMusic: false,
    },
    {
      code: 'P08',
      name: 'Parque Ginebra',
      sequence: 8,
      lat: -9.5241,
      lon: -77.5279,
      chainageMeters: 640,
      observesMusic: true,
    },
    {
      code: 'P09',
      name: 'Mercado Central',
      sequence: 9,
      lat: -9.5249,
      lon: -77.5271,
      chainageMeters: 720,
      observesMusic: false,
    },
  ],
  schedule: [
    { weekday: 1, plannedStart: '07:00' },
    { weekday: 2, plannedStart: '07:00' },
    { weekday: 3, plannedStart: '07:00' },
    { weekday: 4, plannedStart: '07:00' },
    { weekday: 5, plannedStart: '07:00' },
    { weekday: 6, plannedStart: '08:00' },
  ],
};

/** 17:30 in Lima (UTC-5). */
export const FIX_AT = '2026-10-20T22:30:00.000Z';

export const liveEta = (pointCode: string, minMinutes: number, maxMinutes: number): PointEta => ({
  pointId: `id-${pointCode}`,
  pointCode,
  status: 'live',
  predictedPassAt: '2026-10-20T22:40:00.000Z',
  secondsRemaining: 600,
  window: { minMinutes, maxMinutes },
});

export const eta = (pointCode: string, status: 'passed' | 'stale' | 'not_started'): PointEta => ({
  pointId: `id-${pointCode}`,
  pointCode,
  status,
});

export function trip(overrides: Partial<LiveTrip> = {}): LiveTrip {
  return {
    tripId: 'trip-1',
    startedAt: '2026-10-20T22:00:00.000Z',
    startMode: 'auto',
    vehicle: { code: 'UNIDAD-A', label: 'Unidad A (compactadora)' },
    signal: 'live',
    lastFixAt: FIX_AT,
    lastPosition: { lat: -9.5235, lon: -77.5283, fixTime: FIX_AT },
    progress: { chainageMeters: 120, percent: 9.3, offRoute: false },
    etas: [eta('P01', 'passed'), liveEta('P08', 8, 12), liveEta('P09', 10, 14)],
    passes: [
      {
        pointId: 'id-P01',
        pointCode: 'P01',
        passedAt: '2026-10-20T22:20:00.000Z',
        precision: 'interpolated',
      },
    ],
    alerts: [],
    ...overrides,
  };
}

export function snapshot(trips: readonly LiveTrip[] = [trip()]): LiveSnapshot {
  return {
    route: { code: ROUTE.code, name: ROUTE.name },
    generatedAt: FIX_AT,
    staleAfterSeconds: 60,
    trips,
  };
}
