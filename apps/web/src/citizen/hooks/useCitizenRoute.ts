import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../../shared/http';
import type { RouteDetail } from '../api/types';
import type { CitizenDeps } from '../citizen-deps';
import { parseDeepLink } from '../deep-link';
import {
  loadPreferences,
  mergeDeepLink,
  savePreferences,
  type CitizenPreferences,
} from '../preferences';

export type CitizenRoute =
  | { readonly status: 'loading' }
  /** No active route, or the API could not be reached. */
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'ready';
      readonly route: RouteDetail;
      /** The household's point; null until chosen (QR link, saved choice or the form). */
      readonly pointCode: string | null;
      readonly householdCode: string | null;
      readonly selectPoint: (pointCode: string) => void;
    };

/**
 * Resolves the household's route and point: the QR deep link first, then the saved choice, then
 * the first active route. A point that is not on the route is dropped. Choices are saved locally.
 */
export function useCitizenRoute(deps: CitizenDeps, search: string): CitizenRoute {
  const [initial] = useState(() =>
    mergeDeepLink(loadPreferences(deps.storage), parseDeepLink(search)),
  );
  const [route, setRoute] = useState<RouteDetail | null | 'unavailable'>(null);
  const [preferences, setPreferences] = useState<CitizenPreferences>(initial);

  useEffect(() => {
    let cancelled = false;
    void resolveRoute(deps, initial.routeCode).then((resolved) => {
      if (cancelled) return;
      setRoute(resolved ?? 'unavailable');
      if (resolved === null) return;
      setPreferences((current) => {
        const pointCode = resolved.points.some((p) => p.code === current.pointCode)
          ? current.pointCode
          : null;
        const next = { ...current, routeCode: resolved.code, pointCode };
        savePreferences(deps.storage, next);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [deps, initial.routeCode]);

  const selectPoint = useCallback(
    (pointCode: string) =>
      setPreferences((current) => {
        const next = { ...current, pointCode };
        savePreferences(deps.storage, next);
        return next;
      }),
    [deps.storage],
  );

  if (route === null) return { status: 'loading' };
  if (route === 'unavailable') return { status: 'unavailable' };
  return {
    status: 'ready',
    route,
    pointCode: preferences.pointCode,
    householdCode: preferences.householdCode,
    selectPoint,
  };
}

async function resolveRoute(deps: CitizenDeps, routeCode: string | null) {
  try {
    if (routeCode !== null) {
      try {
        return await deps.api.getRoute(routeCode);
      } catch (error) {
        // A route that no longer exists falls back to the catalog; other errors are final.
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    }
    const [first] = await deps.api.listRoutes();
    return first === undefined ? null : await deps.api.getRoute(first.code);
  } catch {
    return null;
  }
}
