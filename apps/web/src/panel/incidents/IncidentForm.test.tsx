import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IncidentForm } from './IncidentForm';

function renderForm(trips: readonly { id: string; label: string }[]) {
  const onSubmit = vi.fn(() => Promise.resolve());
  const props = {
    routeCode: 'RI-01',
    points: [],
    initial: { kind: 'gps_failure' as const, tripId: 'trip-1' },
    now: Date.parse('2026-10-20T22:30:00.000Z'),
    submitLabel: 'Registrar incidencia',
    onSubmit,
    onCancel: () => undefined,
    describeError: () => 'error',
  };
  const view = render(<IncidentForm {...props} trips={trips} />);
  return {
    onSubmit,
    rerender: (next: typeof trips) => view.rerender(<IncidentForm {...props} trips={next} />),
  };
}

describe('IncidentForm', () => {
  it('keeps the chosen trip while it is still offered', async () => {
    const { onSubmit } = renderForm([{ id: 'trip-1', label: 'Unidad A' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Registrar incidencia' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ tripId: 'trip-1' }));
  });

  it('drops a trip that ended while the form was open, and shows that none is chosen', async () => {
    const { onSubmit, rerender } = renderForm([{ id: 'trip-1', label: 'Unidad A' }]);
    rerender([]);

    expect(screen.getByLabelText('Viaje (opcional)')).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar incidencia' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.not.objectContaining({ tripId: 'trip-1' }));
  });
});
