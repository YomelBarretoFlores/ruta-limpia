import { useEffect, useRef } from 'react';

import type { CitizenDeps } from '../citizen-deps';
import { createViewReporter, type ViewReporter } from '../usage/view-reporter';

/**
 * Reports an app view (adoption indicator) once the household's point is known, then each time
 * the page becomes visible again, at most once every 5 minutes. When this browser is subscribed,
 * the view carries the subscription proof so it counts for the household.
 */
export function useViewReporting(
  deps: CitizenDeps,
  routeCode: string | null,
  pointCode: string | null,
): void {
  const latest = useRef({ routeCode, pointCode });
  useEffect(() => {
    latest.current = { routeCode, pointCode };
  }, [routeCode, pointCode]);
  const reporter = useRef<ViewReporter | null>(null);
  const ready = pointCode !== null;

  useEffect(() => {
    if (!ready) return undefined;
    // One reporter per page load, so its throttle survives re-renders and effect re-runs.
    reporter.current ??= createViewReporter({
      now: deps.now,
      send: async () => {
        const { routeCode: route, pointCode: point } = latest.current;
        if (point === null) return;
        const credentials = await deps.viewCredentials().catch(() => null);
        await deps.api.recordView({
          pointCode: point,
          ...(route === null ? {} : { routeCode: route }),
          ...(credentials ?? {}),
        });
      },
    });
    const views = reporter.current;
    views.report();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') views.report();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [deps, ready]);
}
