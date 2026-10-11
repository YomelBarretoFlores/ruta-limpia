import { useEffect, useReducer } from 'react';

import type { CitizenDeps } from '../citizen-deps';
import { connectLive } from '../live/live-connection';
import { INITIAL_LIVE_STATE, liveReducer, type LiveState } from '../live/live-state';

/** The live state of the route, kept up to date while the page is open. */
export function useLiveRoute(deps: CitizenDeps, routeCode: string | null): LiveState {
  const [state, dispatch] = useReducer(liveReducer, INITIAL_LIVE_STATE);

  useEffect(() => {
    if (routeCode === null) return undefined;
    return connectLive({
      streamUrl: deps.api.liveStreamUrl(routeCode),
      fetchSnapshot: () => deps.api.getLiveSnapshot(routeCode),
      createEventSource: deps.createEventSource,
      dispatch,
    });
  }, [deps, routeCode]);

  return state;
}
