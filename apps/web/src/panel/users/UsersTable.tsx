import { Status } from '../../shared/ui/Status';
import type { PanelUser } from '../api/types';
import { formatDateTime } from '../format';
import { ROLE_LABELS } from '../session/permissions';

export interface UsersTableProps {
  readonly users: readonly PanelUser[];
  readonly currentUserId: string;
  readonly selectedId: string | null;
  readonly onEdit: (id: string) => void;
}

export function UsersTable({ users, currentUserId, selectedId, onEdit }: UsersTableProps) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">Cuentas del panel</caption>
        <thead>
          <tr>
            <th scope="col">Usuario</th>
            <th scope="col">Nombre</th>
            <th scope="col">Rol</th>
            <th scope="col">Estado</th>
            <th scope="col">Último ingreso</th>
            <th scope="col">
              <span className="visually-hidden">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className={user.id === selectedId ? 'is-selected' : undefined}>
              <th scope="row" className="num">
                {user.username}
                {user.id === currentUserId && <span className="cell-note"> (tú)</span>}
              </th>
              <td>{user.displayName}</td>
              <td>{ROLE_LABELS[user.role]}</td>
              <td>
                <Status
                  tone={user.active ? 'live' : 'none'}
                  label={user.active ? 'Activa' : 'Desactivada'}
                />
              </td>
              <td className="num">{formatDateTime(user.lastLoginAt)}</td>
              <td className="cell-actions">
                <button type="button" className="link-button" onClick={() => onEdit(user.id)}>
                  Editar <span className="visually-hidden">{user.username}</span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
