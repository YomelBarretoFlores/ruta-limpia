import { act, screen, within } from '@testing-library/react';
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
    const router = renderPanel('/panel/usuarios', fakePanelDeps(api));

    expect(await screen.findByRole('heading', { name: 'Ingresar al panel' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?volver=%2Fpanel%2Fusuarios');
    await signIn();

    expect(await screen.findByRole('heading', { level: 1, name: 'Usuarios' })).toBeInTheDocument();
    expect(api.login).toHaveBeenCalledWith('ana.torres', 'a long passphrase');
    expect(router.state.location.pathname).toBe('/panel/usuarios');
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
    const router = renderPanel('/panel/usuarios', deps);
    await screen.findByRole('heading', { level: 1, name: 'Usuarios' });

    act(() => deps.expireSession());

    expect(
      await screen.findByText('Tu sesión terminó. Ingresa de nuevo para continuar.'),
    ).toBeInTheDocument();
    expect(new URLSearchParams(router.state.location.search).get('volver')).toBe('/panel/usuarios');
  });

  it('shows only the sections of the role, and signs out', async () => {
    const api = fakePanelApi(panelUser('observer'));
    const router = renderPanel('/panel/usuarios', fakePanelDeps(api));

    const nav = await screen.findByRole('navigation', { name: 'Secciones del panel' });
    expect(within(nav).queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument();
    expect(await screen.findByText('Sin acceso')).toBeInTheDocument();
    expect(screen.getByText('Rosa Quispe')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));

    expect(api.logout).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'Ingresar al panel' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/panel/ingresar');
  });

  it('stays signed in and says so when the server could not end the session', async () => {
    const api = fakePanelApi(panelUser('observer'));
    api.logout.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const router = renderPanel('/panel', fakePanelDeps(api));

    await userEvent.click(await screen.findByRole('button', { name: 'Salir' }));

    expect(await screen.findByText('No se pudo cerrar la sesión')).toBeInTheDocument();
    expect(router.state.location.pathname).not.toBe('/panel/ingresar');
    // Trying again works.
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(await screen.findByRole('heading', { name: 'Ingresar al panel' })).toBeInTheDocument();
  });

  it('signs out when the server says the session had already ended', async () => {
    const api = fakePanelApi(panelUser('observer'));
    api.logout.mockRejectedValueOnce(new PanelApiError(401, null));
    renderPanel('/panel', fakePanelDeps(api));

    await userEvent.click(await screen.findByRole('button', { name: 'Salir' }));

    expect(await screen.findByRole('heading', { name: 'Ingresar al panel' })).toBeInTheDocument();
  });
});
