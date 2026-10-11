import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PanelApiError } from './api/panel-api';
import { AUTH_BUSY_MESSAGE, INVALID_CREDENTIALS_MESSAGE } from './session/login-messages';
import { panelUser } from './test/fixtures';
import { fakePanelApi, fakePanelDeps, renderPanel } from './test/fake-panel-deps';

async function signIn(username = 'ana.torres', password = 'a long passphrase') {
  await userEvent.type(await screen.findByLabelText('Usuario'), username);
  await userEvent.type(screen.getByLabelText('Contraseña'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
}

describe('panel sign-in and session', () => {
  it('sends a signed-out visitor to the sign-in page and back to the page they asked for', async () => {
    const api = fakePanelApi(null);
    api.login.mockResolvedValue(panelUser('admin'));
    const router = renderPanel('/panel/viajes', fakePanelDeps(api));

    expect(await screen.findByRole('heading', { name: 'Ingresar al panel' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?volver=%2Fpanel%2Fviajes');
    await signIn();

    expect(
      await screen.findByRole('navigation', { name: 'Secciones del panel' }),
    ).toBeInTheDocument();
    expect(api.login).toHaveBeenCalledWith('ana.torres', 'a long passphrase');
    expect(router.state.location.pathname).toBe('/panel/viajes');
  });

  it('says the same thing for every wrong sign-in, and asks to wait when the service is busy', async () => {
    const api = fakePanelApi(null);
    api.login.mockRejectedValueOnce(new PanelApiError(401, 'invalid_credentials'));
    api.login.mockRejectedValueOnce(new PanelApiError(503, 'auth_busy'));
    renderPanel('/panel/ingresar', fakePanelDeps(api));

    await signIn();
    expect(await screen.findByText(INVALID_CREDENTIALS_MESSAGE)).toBeInTheDocument();
    await signIn();
    expect(await screen.findByText(AUTH_BUSY_MESSAGE)).toBeInTheDocument();
  });

  it('never returns to another site after signing in', async () => {
    const api = fakePanelApi(null);
    api.login.mockResolvedValue(panelUser('observer'));
    const router = renderPanel('/panel/ingresar?volver=https://evil.example/', fakePanelDeps(api));

    await signIn();

    await screen.findByRole('navigation', { name: 'Secciones del panel' });
    expect(router.state.location.pathname.startsWith('/panel')).toBe(true);
  });

  it('goes back to the sign-in page, keeping the page, when the session ends', async () => {
    const deps = fakePanelDeps(fakePanelApi(panelUser('admin')));
    const router = renderPanel('/panel/viajes', deps);
    await screen.findByRole('navigation', { name: 'Secciones del panel' });

    act(() => deps.expireSession());

    expect(
      await screen.findByText('Tu sesión terminó. Ingresa de nuevo para continuar.'),
    ).toBeInTheDocument();
    expect(new URLSearchParams(router.state.location.search).get('volver')).toBe('/panel/viajes');
  });

  it('shows the user and the role, and signs out', async () => {
    const api = fakePanelApi(panelUser('observer'));
    const router = renderPanel('/panel/viajes', fakePanelDeps(api));

    await screen.findByRole('navigation', { name: 'Secciones del panel' });
    expect(screen.getByText('Rosa Quispe')).toBeInTheDocument();
    expect(screen.getByText(/Observador/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));

    expect(api.logout).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'Ingresar al panel' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/panel/ingresar');
  });
});
