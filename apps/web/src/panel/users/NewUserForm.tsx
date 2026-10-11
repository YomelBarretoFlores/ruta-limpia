import { useState, type FormEvent } from 'react';

import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import type { NewUser, Role } from '../api/types';
import { ROLE_LABELS } from '../session/permissions';
import { PASSWORD_HINT, passwordError } from './password';

export interface NewUserFormProps {
  readonly onCreate: (user: NewUser) => Promise<void>;
  readonly describeError: (error: unknown) => string;
}

const EMPTY = { username: '', displayName: '', role: 'observer' as Role, password: '' };

/** "Nueva cuenta": username, name, role and an initial password the person changes later. */
export function NewUserForm({ onCreate, describeError }: NewUserFormProps) {
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [working, setWorking] = useState(false);
  const weak = passwordError(values.password);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (weak !== null || values.username.trim() === '' || values.displayName.trim() === '') return;
    setWorking(true);
    setError(null);
    try {
      await onCreate({
        username: values.username.trim().toLowerCase(),
        displayName: values.displayName.trim(),
        role: values.role,
        password: values.password,
      });
      setValues(EMPTY);
      setChecked(false);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="panel-section" aria-labelledby="new-user-title">
      <h2 id="new-user-title" className="panel-section__title">
        Nueva cuenta
      </h2>
      {error !== null && (
        <Notice tone="danger">
          <p>{error}</p>
        </Notice>
      )}
      <form className="form-grid" onSubmit={(event) => void submit(event)} noValidate>
        <Field
          id="new-user-username"
          label="Usuario"
          hint="De 3 a 32 caracteres: minúsculas, números, punto o guion. Ejemplo: ana.torres"
          error={checked && values.username.trim() === '' ? 'Escribe el usuario.' : undefined}
          control={(control) => (
            <input
              {...control}
              className="input"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={values.username}
              onChange={(event) => setValues({ ...values, username: event.target.value })}
            />
          )}
        />
        <Field
          id="new-user-name"
          label="Nombre para mostrar"
          error={checked && values.displayName.trim() === '' ? 'Escribe el nombre.' : undefined}
          control={(control) => (
            <input
              {...control}
              className="input"
              autoComplete="off"
              value={values.displayName}
              onChange={(event) => setValues({ ...values, displayName: event.target.value })}
            />
          )}
        />
        <Field
          id="new-user-role"
          label="Rol"
          control={(control) => (
            <select
              {...control}
              className="select"
              value={values.role}
              onChange={(event) => setValues({ ...values, role: event.target.value as Role })}
            >
              {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          id="new-user-password"
          label="Contraseña inicial"
          hint={PASSWORD_HINT}
          error={checked ? (weak ?? undefined) : undefined}
          control={(control) => (
            <input
              {...control}
              className="input"
              type="password"
              autoComplete="new-password"
              value={values.password}
              onChange={(event) => setValues({ ...values, password: event.target.value })}
            />
          )}
        />
        <div className="form-actions">
          <Button type="submit" className="button--compact" disabled={working}>
            {working ? 'Creando…' : 'Crear cuenta'}
          </Button>
        </div>
      </form>
    </section>
  );
}
