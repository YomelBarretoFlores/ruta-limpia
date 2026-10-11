import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useSession } from './session-context';

export const LOGIN_PATH = '/panel/ingresar';

/** Shows its children to a signed-in user; anyone else goes to the sign-in page and comes back. */
export function RequireSession({ children }: { readonly children: ReactNode }) {
  const { state } = useSession();
  const location = useLocation();
  if (state.status === 'loading') return <p className="panel-loading">Cargando el panel…</p>;
  if (state.status === 'anonymous') {
    const target = `${location.pathname}${location.search}`;
    const params = new URLSearchParams({ volver: target });
    if (state.expired) params.set('motivo', 'sesion');
    return <Navigate to={`${LOGIN_PATH}?${params.toString()}`} replace />;
  }
  return children;
}
