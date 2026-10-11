import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ArrivalView, TruckSignal } from '../live/live-state';
import { FIX_AT, ROUTE } from '../test/fixtures';
import { ArrivalSection, type ArrivalSectionProps } from './ArrivalSection';

/** The truck signal that usually comes with each arrival view. */
function signalOf(arrival: ArrivalView): TruckSignal {
  switch (arrival.kind) {
    case 'loading':
      return 'loading';
    case 'no_trip':
      return 'no_trip';
    case 'stale':
      return 'stale';
    case 'starting':
      return 'none';
    default:
      return 'live';
  }
}

function renderSection(arrival: ArrivalView, overrides: Partial<ArrivalSectionProps> = {}) {
  return render(
    <ArrivalSection
      route={{ district: 'Independencia', code: 'RI-01' }}
      point={{ code: 'P08', name: 'Parque Ginebra' }}
      arrival={arrival}
      schedule={ROUTE.schedule}
      connection="live"
      signal={signalOf(arrival)}
      {...overrides}
    />,
  );
}

describe('ArrivalSection', () => {
  it('shows the route, the point and the arrival window with the last update time', () => {
    renderSection({ kind: 'live', minMinutes: 8, maxMinutes: 12, updatedAt: FIX_AT });

    expect(screen.getByRole('heading', { name: 'Llegada del camión' })).toBeInTheDocument();
    expect(screen.getByText('Independencia · tramo RI-01')).toBeInTheDocument();
    expect(screen.getByText('P08')).toBeInTheDocument();
    expect(screen.getByText('Llegada estimada')).toBeInTheDocument();
    expect(screen.getByText('8 a 12 min')).toBeInTheDocument();
    expect(screen.getByText(/Actualizado/)).toHaveTextContent('Actualizado 17:30');
    expect(screen.getByText('En vivo')).toBeInTheDocument();
    expect(screen.queryByText('Horario de referencia')).not.toBeInTheDocument();
  });

  it('says "menos de N min" when the window starts now', () => {
    renderSection({ kind: 'live', minMinutes: 0, maxMinutes: 4, updatedAt: FIX_AT });

    expect(screen.getByText('menos de 4 min')).toBeInTheDocument();
  });

  it('leaves out the update time when the live window has none', () => {
    renderSection({ kind: 'live', minMinutes: 8, maxMinutes: 12, updatedAt: null });

    expect(screen.getByText('8 a 12 min')).toBeInTheDocument();
    expect(screen.queryByText(/Actualizado/)).not.toBeInTheDocument();
  });

  it('removes the window entirely and shows the printed schedule when the signal is stale', () => {
    renderSection({ kind: 'stale', updatedAt: FIX_AT }, { connection: 'reconnecting' });

    expect(screen.queryByText(/Llegada estimada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/min\b/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Sin actualización')).toHaveLength(2); // the status and the notice
    expect(
      screen.getByText(
        'La señal del camión se interrumpió a las 17:30. Usa el horario de referencia.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Lunes a viernes: 07:00')).toBeInTheDocument();
    expect(screen.getByText('Sábado: 08:00')).toBeInTheDocument();
    expect(screen.getByText('Reconectando…')).toBeInTheDocument();
  });

  it('explains a stale signal without a known time', () => {
    renderSection({ kind: 'stale', updatedAt: null });

    expect(
      screen.getByText('La señal del camión se interrumpió. Usa el horario de referencia.'),
    ).toBeInTheDocument();
  });

  it('shows the schedule when no truck runs the route', () => {
    renderSection({ kind: 'no_trip' });

    expect(screen.getByText('El camión aún no inicia el recorrido.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Horario de referencia' })).toBeInTheDocument();
  });

  it('tells when the truck already passed the point, with or without the time', () => {
    const { unmount } = renderSection({ kind: 'passed', passedAt: '2026-10-20T22:42:00.000Z' });

    expect(screen.getByText('El camión ya pasó por tu punto a las 17:42.')).toBeInTheDocument();
    expect(screen.queryByText(/Llegada estimada/)).not.toBeInTheDocument();
    unmount();

    renderSection({ kind: 'passed', passedAt: null });
    expect(screen.getByText('El camión ya pasó por tu punto.')).toBeInTheDocument();
  });

  it('asks for the QR code without a point, and offers to configure alerts', async () => {
    const onConfigureAlerts = vi.fn();
    renderSection({ kind: 'no_trip' }, { point: null, onConfigureAlerts });

    expect(screen.getByText(/código QR de tu punto/)).toBeInTheDocument();
    expect(screen.queryByText('El camión aún no inicia el recorrido.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Configurar aviso' }));
    expect(onConfigureAlerts).toHaveBeenCalledOnce();
  });

  it('never fails on a malformed timestamp: the time is simply left out', () => {
    const { unmount } = renderSection({
      kind: 'live',
      minMinutes: 8,
      maxMinutes: 12,
      updatedAt: 'not-a-time',
    });
    expect(screen.getByText('8 a 12 min')).toBeInTheDocument();
    expect(screen.queryByText(/Actualizado/)).not.toBeInTheDocument();
    unmount();

    const stale = renderSection({ kind: 'stale', updatedAt: '' });
    expect(
      screen.getByText('La señal del camión se interrumpió. Usa el horario de referencia.'),
    ).toBeInTheDocument();
    stale.unmount();

    renderSection({ kind: 'passed', passedAt: '2026-99-99' });
    expect(screen.getByText('El camión ya pasó por tu punto.')).toBeInTheDocument();
  });

  it('shows the truck signal as the header status, not the connection', () => {
    const { unmount } = renderSection({ kind: 'stale', updatedAt: FIX_AT }, { connection: 'live' });
    // A live stream that reports a silent truck is not "En vivo".
    expect(screen.queryByText('En vivo')).not.toBeInTheDocument();
    expect(screen.getAllByText('Sin actualización').length).toBeGreaterThan(0);
    unmount();

    const idle = renderSection({ kind: 'no_trip' });
    expect(screen.getByText('Sin recorrido')).toBeInTheDocument();
    idle.unmount();

    renderSection({ kind: 'starting', updatedAt: null });
    expect(screen.getByText('Esperando señal')).toBeInTheDocument();
  });

  it('shows the connection only when it is degraded', () => {
    const { unmount } = renderSection(
      { kind: 'live', minMinutes: 8, maxMinutes: 12, updatedAt: FIX_AT },
      { connection: 'reconnecting' },
    );
    expect(screen.getByText('En vivo')).toBeInTheDocument();
    expect(screen.getByText('Reconectando…')).toBeInTheDocument();
    unmount();

    renderSection({ kind: 'live', minMinutes: 8, maxMinutes: 12, updatedAt: FIX_AT });
    expect(screen.queryByText('Reconectando…')).not.toBeInTheDocument();
    expect(screen.queryByText('Conectando…')).not.toBeInTheDocument();
  });
});
