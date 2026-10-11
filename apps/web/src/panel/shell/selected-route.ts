import { createContext, useContext } from 'react';

import type { RouteSummary } from '../../citizen/api/types';

export interface SelectedRoute {
  /** The active routes (the pilot runs one, RI-01). */
  readonly routes: readonly RouteSummary[];
  /** The route the panel shows; null while the catalog loads or when it is empty. */
  readonly routeCode: string | null;
  readonly select: (code: string) => void;
}

export const SelectedRouteContext = createContext<SelectedRoute>({
  routes: [],
  routeCode: null,
  select: () => undefined,
});

export function useSelectedRoute(): SelectedRoute {
  return useContext(SelectedRouteContext);
}
