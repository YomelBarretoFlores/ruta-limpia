import { useCallback, useEffect, useState } from 'react';

import type { PanelLiveSnapshot } from '../api/types';
import { useAsync, type AsyncResult } from '../components/use-async';
import { usePanelDeps } from '../panel-deps';
import { connectPanelLive, type PanelConnection } from './panel-live-connection';

/** The live panel snapshot of a route, refetched on stream events and periodically. */
export function useLivePanel(
  routeCode: string | null,
): AsyncResult<PanelLiveSnapshot | null> & { readonly connection: PanelConnection } {
  const { api, createEventSource } = usePanelDeps();
  const load = useCallback(
    () => (routeCode === null ? Promise.resolve(null) : api.getLive(routeCode)),
    [api, routeCode],
  );
  const live = useAsync(load);
  // The connection state belongs to one route: another route starts "connecting" again.
  const [reported, setReported] = useState<{
    readonly routeCode: string;
    readonly connection: PanelConnection;
  } | null>(null);
  const { reload } = live;

  useEffect(() => {
    if (routeCode === null) return undefined;
    return connectPanelLive({
      streamUrl: api.liveStreamUrl(routeCode),
      createEventSource,
      refetch: reload,
      onConnection: (connection) => setReported({ routeCode, connection }),
    });
  }, [api, createEventSource, routeCode, reload]);

  const connection = reported?.routeCode === routeCode ? reported.connection : 'connecting';
  return { ...live, connection };
}
