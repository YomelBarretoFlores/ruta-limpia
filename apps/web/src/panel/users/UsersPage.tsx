import { useCallback, useState } from 'react';

import { Notice } from '../../shared/ui/Notice';
import type { NewUser, PanelUser, UserChanges } from '../api/types';
import { errorMessage } from '../components/errors';
import { LoadState } from '../components/LoadState';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../components/use-async';
import { usePanelDeps } from '../panel-deps';
import { useUser } from '../session/session-context';
import { NewUserForm } from './NewUserForm';
import { UserEditor } from './UserEditor';
import { USER_ERRORS } from './user-errors';
import { UsersTable } from './UsersTable';

/** `/panel/usuarios` (administrators): the accounts, a new account, and changes to one account. */
export function UsersPage() {
  const { api } = usePanelDeps();
  const me = useUser();
  const load = useCallback(() => api.listUsers(), [api]);
  const users = useAsync(load);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const create = async (user: NewUser) => {
    const created = await api.createUser(user);
    setMessage(`Se creó la cuenta ${created.username}.`);
    users.reload();
  };

  const update = async (user: PanelUser, changes: UserChanges, done: string) => {
    await api.updateUser(user.id, changes);
    setMessage(done);
    users.reload();
  };

  const selected = users.data?.find((u) => u.id === editing) ?? null;
  return (
    <>
      <PageHeader title="Usuarios" kicker="Cuentas del panel y sus roles" />
      {message !== null && (
        <Notice tone="info">
          <p>{message}</p>
        </Notice>
      )}
      {users.data === undefined ? (
        <LoadState
          status={users.status}
          error={users.error}
          onRetry={users.reload}
          what="las cuentas"
        />
      ) : (
        <UsersTable
          users={users.data}
          currentUserId={me.id}
          selectedId={editing}
          onEdit={(id) => {
            setMessage(null);
            setEditing(id);
          }}
        />
      )}
      {selected !== null && (
        <UserEditor
          key={selected.id}
          user={selected}
          isSelf={selected.id === me.id}
          onSave={(changes) =>
            update(selected, changes, `Se guardaron los cambios de ${selected.username}.`)
          }
          onResetPassword={(password) =>
            update(
              selected,
              { password },
              `Se restableció la contraseña de ${selected.username}. Sus sesiones abiertas se cerraron.`,
            )
          }
          onClose={() => setEditing(null)}
          describeError={(error) => errorMessage(error, USER_ERRORS)}
        />
      )}
      <NewUserForm onCreate={create} describeError={(error) => errorMessage(error, USER_ERRORS)} />
    </>
  );
}
