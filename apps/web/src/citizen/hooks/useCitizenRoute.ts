import { useCallback, useEffect, useRef, useState } from 'react';

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
  /**
   * The API could not be reached or failed: the hook tries again by itself (with a growing
   * delay, and at once when the browser comes back online); `retry` tries now.
   */
  | { readonly status: 'unavailable'; readonly retry: () => void }
  /** The API answered, but no route is active (a server-side matter, not the connection). */
  | { readonly status: 'no_route' }
  | {
      readonly status: 'ready';
      readonly route: RouteDetail;
      /** The household's point; null until chosen (QR link, saved choice or the form). */
      readonly pointCode: string | null;
      readonly householdCode: string | null;
      readonly selectPoint: (pointCode: string) => void;
    };

/** Delay before the next automatic try after `failures` failed loads: 2 s, 4 s, 8 s … 60 s. */
export function retryDelayMs(failures: number): number {
  return Math.min(2_000 * 2 ** Math.max(0, failures - 1), 60_000);
}

/**
 * Resolves the household's route and point: the QR deep link first, then the saved choice, then
 * the first active route. A point that is not on the route is dropped. Choices are saved locally.
 * A failed load is retried until it succeeds; an empty catalog is reported as such.
 */
export function useCitizenRoute(deps: CitizenDeps, search: string): CitizenRoute {
  const [initial] = useState(() =>
    mergeDeepLink(loadPreferences(deps.storage), parseDeepLink(search)),
  );
  const [route, setRoute] = useState<RouteDetail | null | 'unavailable' | 'no_route'>(null);
  const [preferences, setPreferences] = useState<CitizenPreferences>(initial);
  /** Bumped to load again (timer, `online` event or `retry`). */
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);
  const loaded = useRef(false);

  const retry = useCallback(() => {
    if (!loaded.current) setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (loaded.current) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void resolveRoute(deps, initial.routeCode).then((resolved) => {
      if (cancelled) return;
      if (resolved.kind === 'error') {
        failures.current += 1;
        setRoute('unavailable');
        timer = setTimeout(retry, retryDelayMs(failures.current));
        return;
      }
      loaded.current = true;
      if (resolved.kind === 'none') {
        setRoute('no_route');
        return;
      }
      const found = resolved.route;
      setRoute(found);
      setPreferences((current) => {
        const pointCode = found.points.some((p) => p.code === current.pointCode)
          ? current.pointCode
          : null;
        const next = { ...current, routeCode: found.code, pointCode };
        savePreferences(deps.storage, next);
        return next;
      });
    });
    window.addEventListener('online', retry);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('online', retry);
    };
  }, [deps, initial.routeCode, attempt, retry]);

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
  if (route === 'unavailable') return { status: 'unavailable', retry };
  if (route === 'no_route') return { status: 'no_route' };
  return {
    status: 'ready',
    route,
    pointCode: preferences.pointCode,
    householdCode: preferences.householdCode,
    selectPoint,
  };
}

type Resolved =
  | { readonly kind: 'ok'; readonly route: RouteDetail }
  /** The catalog is empty: no route is active. */
  | { readonly kind: 'none' }
  /** The network or the server failed: worth trying again. */
  | { readonly kind: 'error' };

async function resolveRoute(deps: CitizenDeps, routeCode: string | null): Promise<Resolved> {
  try {
    if (routeCode !== null) {
      try {
        return { kind: 'ok', route: await deps.api.getRoute(routeCode) };
      } catch (error) {
        // A route that no longer exists falls back to the catalog; other errors are retried.
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    }
    const [first] = await deps.api.listRoutes();
    return first === undefined
      ? { kind: 'none' }
      : { kind: 'ok', route: await deps.api.getRoute(first.code) };
  } catch {
    return { kind: 'error' };
  }
}
