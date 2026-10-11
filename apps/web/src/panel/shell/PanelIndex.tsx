import { Navigate } from 'react-router';

import { useUser } from '../session/session-context';
import { visibleNavItems } from './navigation';

/** `/panel`: the first section the user's role may open. */
export function PanelIndex() {
  const first = visibleNavItems(useUser())[0];
  if (first !== undefined) return <Navigate to={first.to} replace />;
  return <p>Tu rol no tiene secciones disponibles en el panel.</p>;
}
