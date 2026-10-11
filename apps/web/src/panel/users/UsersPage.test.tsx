import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PanelApiError } from '../api/panel-api';
import { panelUser } from '../test/fixtures';
import { fakePanelApi, fakePanelDeps, renderPanel } from '../test/fake-panel-deps';

function setup() {
  const admin = panelUser('admin');
  const observer = panelUser('observer');
  const api = fakePanelApi(admin);
  api.listUsers.mockResolvedValue([admin, observer]);
  renderPanel('/panel/usuarios', fakePanelDeps(api));
  return { api, admin, observer };
}

describe('UsersPage', () => {
  it('lists the accounts with their role and state', async () => {
    setup();

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[2]!).getByText('Observador')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('(tú)')).toBeInTheDocument();
  });

  it('creates an account, explaining the 12-character rule before sending', async () => {
    const { api } = setup();
    api.createUser.mockResolvedValue(panelUser('supervisor', { username: 'luis.ramos' }));
    await screen.findByRole('table');

    await userEvent.type(screen.getByRole('textbox', { name: 'Usuario' }), 'Luis.Ramos');
    await userEvent.type(screen.getByLabelText('Nombre para mostrar'), 'Luis Ramos');
    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'supervisor');
    await userEvent.type(screen.getByLabelText('Contraseña inicial'), 'corta');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(
      screen.getByText('La contraseña debe tener al menos 12 caracteres (tiene 5).'),
    ).toBeInTheDocument();
    expect(api.createUser).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Contraseña inicial'), ' y larga ya');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(api.createUser).toHaveBeenCalledWith({
      username: 'luis.ramos',
      displayName: 'Luis Ramos',
      role: 'supervisor',
      password: 'corta y larga ya',
    });
    expect(await screen.findByText('Se creó la cuenta luis.ramos.')).toBeInTheDocument();
    expect(api.listUsers).toHaveBeenCalledTimes(2);
  });

  it('changes a role, deactivates an account and resets its password', async () => {
    const { api, observer } = setup();
    api.updateUser.mockResolvedValue(observer);
    await screen.findByRole('table');

    await userEvent.click(screen.getByRole('button', { name: `Editar ${observer.username}` }));
    await userEvent.selectOptions(
      screen.getByLabelText('Rol', { selector: '#edit-user-role' }),
      'supervisor',
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /Cuenta activa/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(api.updateUser).toHaveBeenCalledWith(observer.id, { role: 'supervisor', active: false });

    await userEvent.type(screen.getByLabelText('Nueva contraseña'), 'otra frase bien larga');
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));
    expect(api.updateUser).toHaveBeenLastCalledWith(observer.id, {
      password: 'otra frase bien larga',
    });
    expect(await screen.findByText(/Se restableció la contraseña/)).toBeInTheDocument();
  });

  it('refuses a blank name and sends nothing when nothing changed', async () => {
    const { api, observer } = setup();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: `Editar ${observer.username}` }));
    const name = screen.getByLabelText('Nombre para mostrar', { selector: '#edit-user-name' });

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('No hay cambios que guardar.')).toBeInTheDocument();

    await userEvent.clear(name);
    await userEvent.type(name, '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Escribe el nombre.')).toBeInTheDocument();

    expect(api.updateUser).not.toHaveBeenCalled();
    expect(screen.queryByText(/Se guardaron los cambios/)).not.toBeInTheDocument();
  });

  it('explains why administrators cannot demote themselves', async () => {
    const { api, admin } = setup();
    api.updateUser.mockRejectedValue(new PanelApiError(409, 'cannot_modify_self'));
    await screen.findByRole('table');

    await userEvent.click(screen.getByRole('button', { name: `Editar ${admin.username}` }));
    expect(screen.getByLabelText('Rol', { selector: '#edit-user-role' })).toBeDisabled();
    await userEvent.clear(
      screen.getByLabelText('Nombre para mostrar', { selector: '#edit-user-name' }),
    );
    await userEvent.type(
      screen.getByLabelText('Nombre para mostrar', { selector: '#edit-user-name' }),
      'Ana T.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText(
        'No puedes quitarte el rol de administrador ni desactivar tu propia cuenta.',
      ),
    ).toBeInTheDocument();
  });
});
