import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Trip, TripDetail } from '../api/types';
import { panelUser } from '../test/fixtures';
import { fakePanelApi, fakePanelDeps, renderPanel } from '../test/fake-panel-deps';

vi.mock('../map/PanelRouteMap', () => ({
  default: ({ track }: { track: unknown[] | null }) => (
    <div data-testid="map">{track?.length ?? 0} posiciones</div>
  ),
}));

const TRIP: Trip = {
  id: 'trip-1',
  routeCode: 'RI-01',
  routeName: 'Av. Centenario – Independencia',
  vehicleCode: 'UNIDAD-A',
  vehicleLabel: 'Unidad A (compactadora)',
  status: 'aborted',
  startMode: 'manual',
  startedAt: '2026-10-20T12:00:00.000Z',
  endedAt: '2026-10-20T13:30:00.000Z',
  endReason: 'manual',
  endNote: 'Avería hidráulica',
  passedPoints: 9,
  totalPoints: 15,
  alertsCount: 7,
};

const DETAIL: TripDetail = {
  trip: TRIP,
  summary: { durationSec: 5400, fixCount: 812, offRouteCount: 2, maxGpsGapSec: 95 },
  points: [
    {
      pointId: 'p1',
      pointCode: 'P01',
      pointName: 'Av. Centenario · punto 1',
      sequence: 1,
      passedAt: '2026-10-20T12:10:00.000Z',
      precision: 'interpolated',
      alert: {
        emittedAt: '2026-10-20T12:02:00.000Z',
        communicatedPredictedPassAt: '2026-10-20T12:11:00.000Z',
        secondsRemainingAtEmission: 540,
        insideTargetWindow: true,
        recipients: 12,
        delivered: 12,
        receiptsReceived: 10,
        failed: 0,
      },
    },
    {
      pointId: 'p8',
      pointCode: 'P08',
      pointName: 'Av. Centenario · punto 8',
      sequence: 8,
      passedAt: null,
      precision: null,
      alert: null,
    },
  ],
  incidents: [
    {
      id: 'i-1',
      kind: 'truck_breakdown',
      pointCode: 'P08',
      description: 'Pérdida de aceite',
      occurredAt: '2026-10-20T13:20:00.000Z',
      resolvedAt: null,
    },
  ],
  track: {
    type: 'LineString',
    coordinates: [
      [-77.5285, -9.5234],
      [-77.528, -9.524],
    ],
  },
};

describe('TripsPage', () => {
  it('lists the trips of the selected route and filters by state and dates', async () => {
    const api = fakePanelApi(panelUser('supervisor'));
    api.listTrips.mockResolvedValue({ items: [TRIP], page: 1, pageSize: 20, total: 1 });
    renderPanel('/panel/viajes', fakePanelDeps(api));

    const table = await screen.findByRole('table');
    expect(within(table).getByText('20/10/2026 07:00')).toBeInTheDocument();
    expect(within(table).getByText('1 h 30 min')).toBeInTheDocument();
    expect(within(table).getByText('9 / 15')).toBeInTheDocument();
    expect(api.listTrips).toHaveBeenLastCalledWith(
      expect.objectContaining({ route: 'RI-01', page: 1, pageSize: 20 }),
    );

    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'aborted');
    expect(api.listTrips).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'aborted' }));
    await userEvent.type(screen.getByLabelText('Desde'), '2026-10-01');
    expect(api.listTrips).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-01' }));
  });
});

describe('TripDetailPage', () => {
  it('shows the summary, each point with its alert, the incidents and the track', async () => {
    const api = fakePanelApi(panelUser('supervisor'));
    api.getTrip.mockResolvedValue(DETAIL);
    renderPanel('/panel/viajes/trip-1', fakePanelDeps(api));

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Viaje del 20/10/2026 · Unidad A (compactadora)',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('812')).toBeInTheDocument();
    expect(screen.getByText('1 min 35 s')).toBeInTheDocument();
    expect(screen.getByText('Avería hidráulica')).toBeInTheDocument();

    const points = screen.getByRole('table', { name: 'Paso y aviso por punto' });
    const [first, second] = within(points).getAllByRole('row').slice(1);
    expect(
      within(first!)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['07:10', 'Interpolado', '07:02', '07:11', 'Sí', '10 / 12']);
    expect(within(second!).getByText('Sin aviso')).toBeInTheDocument();
    expect(screen.getByText('Pérdida de aceite')).toBeInTheDocument();
    expect(await screen.findByTestId('map')).toHaveTextContent('2 posiciones');
  });
});
