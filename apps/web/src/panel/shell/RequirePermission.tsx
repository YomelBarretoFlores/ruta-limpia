import type { ReactNode } from 'react';

import { Notice } from '../../shared/ui/Notice';
import type { Permission } from '../api/types';
import { canAny } from '../session/permissions';
import { useUser } from '../session/session-context';

/** A section for some roles only; the API refuses the others anyway, this explains it. */
export function RequirePermission({
  anyOf,
  children,
}: {
  readonly anyOf: readonly Permission[];
  readonly children: ReactNode;
}) {
  const user = useUser();
  if (canAny(user, anyOf)) return children;
  return (
    <Notice tone="warn" title="Sin acceso">
      <p>Tu rol no permite ver esta sección. Si la necesitas, pídela al administrador.</p>
    </Notice>
  );
}
