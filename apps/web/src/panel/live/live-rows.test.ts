import { describe, expect, it } from 'vitest';

import { trip as publicTrip } from '../../citizen/test/fixtures';
import type { PanelLiveSnapshot, PanelPoint } from '../api/types';
import { ALERT_STATUS } from '../labels';
import { PANEL_ROUTE } from '../test/fixtures';
import { liveRows } from './live-rows';

const point = (overrides: Partial<PanelPoint> & Pick<PanelPoint, 'pointCode' | 'sequence'>) =>
  ({
    pointId: `id-${overrides.pointCode}`,
    name: `Av. Centenario · punto ${overrides.sequence}`,
    alertStatus: 'waiting',
    eta: null,
    passedAt: null,
    alert: null,
    ...overrides,
  }) satisfies PanelPoint;

function snapshot(points: PanelPoint[]): PanelLiveSnapshot {
  return {
    route: { code: 'RI-01', name: 'Av. Centenario – Independencia' },
    generatedAt: '2026-10-20T22:30:00.000Z',
    staleAfterSeconds: 60,
    trips: [{ ...publicTrip(), points }],
    openIncidents: [
      {
        id: 'i-1',
        kind: 'missed_collection',
        tripId: null,
        pointCode: 'P09',
        description: null,
        occurredAt: '2026-10-20T22:00:00.000Z',
      },
    ],
  };
}

describe('liveRows', () => {
  it('maps each point to its pass, alert state, deliveries and incidents, in route order', () => {
    const rows = liveRows(
      snapshot([
        point({
          pointCode: 'P09',
          sequence: 9,
          alertStatus: 'preparing',
          eta: {
            pointId: 'id-P09',
            pointCode: 'P09',
            status: 'live',
            predictedPassAt: '2026-10-20T22:42:00.000Z',
            secondsRemaining: 720,
            window: { minMinutes: 10, maxMinutes: 14 },
          },
        }),
        point({
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
        point({ pointCode: 'P08', sequence: 8, alertStatus: 'not_sent', passedAt: 'x' }),
      ]),
      PANEL_ROUTE,
    );

    expect(rows.map((r) => [r.pointCode, ALERT_STATUS[r.alertStatus!].label])).toEqual([
      ['P01', 'Enviado'],
      ['P08', 'No enviado'],
      ['P09', 'En preparación'],
    ]);
    expect(rows[0]).toMatchObject({ deliveries: { received: 9, sent: 12, failed: 1 } });
    expect(rows[2]).toMatchObject({ predictedAt: '2026-10-20T22:42:00.000Z', deliveries: null });
    expect(rows[2]!.incidents.map((i) => i.id)).toEqual(['i-1']);
    expect(ALERT_STATUS.waiting.label).toBe('En espera');
  });

  it('lists the route points without states when no truck runs the route', () => {
    const empty = { ...snapshot([]), trips: [] };

    const rows = liveRows(empty, PANEL_ROUTE);

    expect(rows.map((r) => r.pointCode)).toEqual(['P01', 'P08', 'P09']);
    expect(rows.every((r) => r.alertStatus === null && r.passedAt === null)).toBe(true);
  });
});
