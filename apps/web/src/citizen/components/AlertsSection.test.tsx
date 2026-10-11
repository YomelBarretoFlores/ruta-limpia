import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ROUTE } from '../test/fixtures';
import { AlertsSection, type AlertsSectionProps } from './AlertsSection';

function renderSection(overrides: Partial<AlertsSectionProps> = {}) {
  const props: AlertsSectionProps = {
    zone: 'Independencia · RI-01',
    points: ROUTE.points,
    selectedPointCode: 'P08',
    onSelectPoint: vi.fn(),
    householdCode: null,
    support: 'supported',
    phase: 'idle',
    routeCode: 'RI-01',
    subscribedPointCode: null,
    subscribedRouteCode: null,
    consent: false,
    onConsentChange: vi.fn(),
    message: null,
    onActivate: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<AlertsSection {...props} />);
  return props;
}

describe('AlertsSection', () => {
  it('shows the zone, the preselected point, the preference and the privacy notes', () => {
    renderSection({ householdCode: 'H-001' });

    expect(screen.getByRole('heading', { name: 'Avisos de llegada' })).toBeInTheDocument();
    expect(screen.getByText('Solo con consentimiento del hogar')).toBeInTheDocument();
    expect(screen.getByLabelText('Zona urbana')).toHaveValue('Independencia · RI-01');
    expect(screen.getByLabelText('Punto cercano')).toHaveValue('P08');
    expect(screen.getByRole('radio', { name: 'Al aproximarse a mi punto' })).toBeChecked();
    expect(screen.getByText('H-001')).toBeInTheDocument();
    expect(screen.getByText('No se publicará la dirección del hogar.')).toBeInTheDocument();
    expect(
      screen.getByText('Activar notificaciones depende del dispositivo y de sus permisos.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Puedes cancelar los avisos cuando quieras.')).toBeInTheDocument();
  });

  it('keeps "Activar avisos" disabled until the household consents', async () => {
    const props = renderSection();
    const activate = screen.getByRole('button', { name: 'Activar avisos' });

    expect(activate).toBeDisabled();
    await userEvent.click(
      screen.getByRole('checkbox', {
        name: 'Acepto recibir avisos y el uso de mi punto de referencia.',
      }),
    );
    expect(props.onConsentChange).toHaveBeenCalledWith(true);
  });

  it('activates with consent and a point, and lets the household change the point', async () => {
    const props = renderSection({ consent: true });

    await userEvent.selectOptions(screen.getByLabelText('Punto cercano'), 'P09');
    await userEvent.click(screen.getByRole('button', { name: 'Activar avisos' }));

    expect(props.onSelectPoint).toHaveBeenCalledWith('P09');
    expect(props.onActivate).toHaveBeenCalledOnce();
  });

  it('needs a point before activating', () => {
    renderSection({ consent: true, selectedPointCode: null });

    expect(screen.getByLabelText('Punto cercano')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Activar avisos' })).toBeDisabled();
  });

  it('shows the home screen steps instead of the button on iPhone Safari', () => {
    renderSection({ consent: true, support: 'ios_install' });

    expect(screen.queryByRole('button', { name: 'Activar avisos' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Para recibir avisos en iPhone o iPad' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Agregar a pantalla de inicio')).toBeInTheDocument();
  });

  it('explains when the browser cannot receive alerts', () => {
    renderSection({ support: 'unsupported' });

    expect(screen.queryByRole('button', { name: 'Activar avisos' })).not.toBeInTheDocument();
    expect(screen.getByText(/Este navegador no puede recibir avisos/)).toBeInTheDocument();
  });

  it('offers to cancel an active subscription', async () => {
    const props = renderSection({ phase: 'subscribed', subscribedPointCode: 'P08' });

    expect(screen.getByText(/Avisos activados para el punto/)).toHaveTextContent('P08');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar avisos' }));
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it('names the route of a subscription made on another route, and offers to cancel it', () => {
    renderSection({
      phase: 'subscribed',
      subscribedPointCode: 'P03',
      subscribedRouteCode: 'RH-02',
    });

    expect(screen.getByText(/Tienes avisos activados para el punto/)).toHaveTextContent(
      'Tienes avisos activados para el punto P03 de la ruta RH-02.',
    );
    expect(
      screen.getByText('Para recibir avisos en esta zona, primero cancela esos avisos.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar avisos' })).toBeInTheDocument();
  });
});
