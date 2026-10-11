import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import { usePanelDeps } from '../panel-deps';
import { loginErrorMessage } from './login-messages';
import { safeReturnPath } from './permissions';
import { useSession } from './session-context';

/** `/panel/ingresar`: username and password; back to the page the user wanted afterwards. */
export function LoginPage() {
  const { api } = usePanelDeps();
  const { state, signedIn } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const target = safeReturnPath(params.get('volver'));

  if (state.status === 'authenticated' && !working) return <Navigate to={target} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      const user = await api.login(username.trim(), password);
      signedIn(user);
      void navigate(target, { replace: true });
    } catch (failure) {
      setError(loginErrorMessage(failure));
      setPassword('');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="panel-login" data-density="panel">
      <header className="panel-login__header">
        <p className="panel-wordmark">Ruta Limpia</p>
        <p className="panel-login__district">Panel municipal · Independencia</p>
      </header>
      <main className="panel-login__main">
        <h1>Ingresar al panel</h1>
        {params.get('motivo') === 'sesion' && error === null && (
          <Notice tone="info">
            <p>Tu sesión terminó. Ingresa de nuevo para continuar.</p>
          </Notice>
        )}
        {error !== null && (
          <Notice tone="danger">
            <p>{error}</p>
          </Notice>
        )}
        <form onSubmit={(event) => void submit(event)} noValidate>
          <Field
            id="login-username"
            label="Usuario"
            control={(control) => (
              <input
                {...control}
                className="input"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            )}
          />
          <Field
            id="login-password"
            label="Contraseña"
            control={(control) => (
              <input
                {...control}
                className="input"
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          />
          <Button type="submit" disabled={working || username.trim() === '' || password === ''}>
            {working ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>
        <p className="panel-login__help">
          Acceso para el personal municipal y el equipo de campo. Si olvidaste tu contraseña, pide
          al administrador que la restablezca.
        </p>
      </main>
    </div>
  );
}
