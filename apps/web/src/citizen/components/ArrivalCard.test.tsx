import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ArrivalView } from '../live/live-state';
import { FIX_AT, ROUTE } from '../test/fixtures';
import { ArrivalCard, type ArrivalCardProps } from './ArrivalCard';

function renderCard(arrival: ArrivalView, overrides: Partial<ArrivalCardProps> = {}) {
  return render(
    <ArrivalCard
      route={{ district: 'Independencia', code: 'RI-01' }}
      point={{ code: 'P08', name: 'Parque Ginebra' }}
      arrival={arrival}
      schedule={ROUTE.schedule}
      connection="live"
      {...overrides}
    />,
  );
}

describe('ArrivalCard', () => {
  it('shows the route, the point and the arrival window with the last update time', () => {
    renderCard({ kind: 'live', minMinutes: 8, maxMinutes: 12, updatedAt: FIX_AT });

    expect(screen.getByRole('heading', { name: 'Mapa y llegada del camión' })).toBeInTheDocument();
    expect(screen.getByText('Independencia · tramo RI-01')).toBeInTheDocument();
    expect(screen.getByText('P08')).toBeInTheDocument();
    expect(screen.getByText(/Llegada estimada:/)).toHaveTextContent(
      'Llegada estimada: 8 a 12 minutos',
    );
    expect(screen.getByText('Actualización: 17:30')).toBeInTheDocument();
    expect(screen.getByText('En vivo')).toBeInTheDocument();
    expect(screen.queryByText('Horario de referencia')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Saca los residuos cuando el aviso indique proximidad y usa bolsas cerradas.',
      ),
    ).toBeInTheDocument();
  });

  it('hides the ETA entirely and shows the printed schedule when the signal is stale', () => {
    renderCard({ kind: 'stale', updatedAt: FIX_AT }, { connection: 'reconnecting' });

    expect(screen.queryByText(/Llegada estimada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/minutos/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Sin actualización: la señal del camión se interrumpió. Usa el horario de referencia.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Lunes a viernes: 07:00')).toBeInTheDocument();
    expect(screen.getByText('Sábado: 08:00')).toBeInTheDocument();
    expect(screen.getByText('Reconectando…')).toBeInTheDocument();
  });

  it('shows the schedule when no truck runs the route', () => {
    renderCard({ kind: 'no_trip' });

    expect(screen.getByText('El camión aún no inicia el recorrido')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Horario de referencia' })).toBeInTheDocument();
  });

  it('tells when the truck already passed the point', () => {
    renderCard({ kind: 'passed', passedAt: '2026-10-20T22:42:00.000Z' });

    expect(screen.getByText('El camión ya pasó por tu punto a las 17:42')).toBeInTheDocument();
    expect(screen.queryByText(/Llegada estimada/)).not.toBeInTheDocument();
  });

  it('asks for the QR code without a point, and offers to configure alerts', async () => {
    const onConfigureAlerts = vi.fn();
    renderCard({ kind: 'no_trip' }, { point: null, onConfigureAlerts });

    expect(screen.getByText(/Escanea el código QR/)).toBeInTheDocument();
    expect(screen.queryByText('El camión aún no inicia el recorrido')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Configurar aviso' }));
    expect(onConfigureAlerts).toHaveBeenCalledOnce();
  });
});
