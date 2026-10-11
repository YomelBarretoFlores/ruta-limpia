import { trip as publicTrip } from '../../citizen/test/fixtures';
import type { PanelLiveSnapshot, PanelPoint } from '../api/types';

export function panelPoint(
  overrides: Partial<PanelPoint> & Pick<PanelPoint, 'pointCode' | 'sequence'>,
): PanelPoint {
  return {
    pointId: `id-${overrides.pointCode}`,
    name: `Av. Centenario · punto ${overrides.sequence}`,
    alertStatus: 'waiting',
    eta: null,
    passedAt: null,
    alert: null,
    ...overrides,
  };
}

/** RI-01 with one active trip (UNIDAD-A): P01 alerted and passed, P08 coming, P09 waiting. */
export function liveSnapshot(overrides: Partial<PanelLiveSnapshot> = {}): PanelLiveSnapshot {
  return {
    route: { code: 'RI-01', name: 'Av. Centenario – Independencia' },
    generatedAt: '2026-10-20T22:30:05.000Z',
    staleAfterSeconds: 60,
    trips: [
      {
        ...publicTrip(),
        points: [
          panelPoint({
            pointCode: 'P01',
            sequence: 1,
            alertStatus: 'sent',
            passedAt: '2026-10-20T22:20:00.000Z',
            alert: {
              emittedAt: '2026-10-20T22:12:00.000Z',
              communicatedPredictedPassAt: '2026-10-20T22:21:00.000Z',
              recipients: 12,
              delivered: 11,
              receiptsReceived: 9,
              failed: 1,
            },
          }),
          panelPoint({ pointCode: 'P08', sequence: 8, alertStatus: 'preparing' }),
          panelPoint({ pointCode: 'P09', sequence: 9 }),
        ],
      },
    ],
    openIncidents: [],
    ...overrides,
  };
}
