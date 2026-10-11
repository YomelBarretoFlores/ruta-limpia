import { useState, type FormEvent } from 'react';

import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import type { PanelUser, Role, UserChanges } from '../api/types';
import { ROLE_LABELS } from '../session/permissions';
import { PASSWORD_HINT, passwordError } from './password';

export interface UserEditorProps {
  readonly user: PanelUser;
  /** The signed-in administrator: cannot demote or deactivate themselves. */
  readonly isSelf: boolean;
  readonly onSave: (changes: UserChanges) => Promise<void>;
  readonly onResetPassword: (password: string) => Promise<void>;
  readonly onClose: () => void;
  readonly describeError: (error: unknown) => string;
}

/** One account: name, role and state, and a separate password reset. */
export function UserEditor(props: UserEditorProps) {
  const { user, isSelf, onSave, onResetPassword, onClose, describeError } = props;
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<Role>(user.role);
  const [active, setActive] = useState(user.active);
  const [password, setPassword] = useState('');
  const [passwordChecked, setPasswordChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setWorking(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setWorking(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const changes: UserChanges = {
      ...(displayName.trim() !== user.displayName ? { displayName: displayName.trim() } : {}),
      ...(role !== user.role ? { role } : {}),
      ...(active !== user.active ? { active } : {}),
    };
    void run(() => onSave(changes));
  };

  const reset = (event: FormEvent) => {
    event.preventDefault();
    setPasswordChecked(true);
    if (passwordError(password) !== null) return;
    void run(async () => {
      await onResetPassword(password);
      setPassword('');
      setPasswordChecked(false);
    });
  };

  return (
    <section className="panel-section" aria-labelledby="edit-user-title">
      <div className="panel-section__header">
        <h2 id="edit-user-title" className="panel-section__title">
          Editar la cuenta <span className="num">{user.username}</span>
        </h2>
        <button type="button" className="link-button" onClick={onClose}>
          Cerrar
        </button>
      </div>
      {error !== null && (
        <Notice tone="danger">
          <p>{error}</p>
        </Notice>
      )}
      <form className="form-grid" onSubmit={save} noValidate>
        <Field
          id="edit-user-name"
          label="Nombre para mostrar"
          control={(control) => (
            <input
              {...control}
              className="input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          )}
        />
        <Field
          id="edit-user-role"
          label="Rol"
          hint={isSelf ? 'No puedes cambiar tu propio rol.' : undefined}
          control={(control) => (
            <select
              {...control}
              className="select"
              value={role}
              disabled={isSelf}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              {(Object.keys(ROLE_LABELS) as Role[]).map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        />
        <label className="choice">
          <input
            type="checkbox"
            checked={active}
            disabled={isSelf}
            onChange={(event) => setActive(event.target.checked)}
          />
          <span>Cuenta activa (desactivarla cierra sus sesiones)</span>
        </label>
        <div className="form-actions">
          <Button type="submit" className="button--compact" disabled={working}>
            Guardar cambios
          </Button>
        </div>
      </form>
      <form className="form-grid form-grid--separated" onSubmit={reset} noValidate>
        <Field
          id="edit-user-password"
          label="Nueva contraseña"
          hint={PASSWORD_HINT}
          error={passwordChecked ? (passwordError(password) ?? undefined) : undefined}
          control={(control) => (
            <input
              {...control}
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        />
        <div className="form-actions">
          <Button type="submit" variant="secondary" className="button--compact" disabled={working}>
            Restablecer contraseña
          </Button>
        </div>
      </form>
    </section>
  );
}
