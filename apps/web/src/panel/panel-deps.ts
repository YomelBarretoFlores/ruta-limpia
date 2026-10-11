import { createContext, useContext } from 'react';

import type { EventSourceFactory } from '../citizen/live/live-connection';
import { createPanelApi, type PanelApi } from './api/panel-api';

/** What the panel needs from the outside world; tests provide fakes. */
export interface PanelDeps {
  readonly api: PanelApi;
  /** Null without `EventSource`: the live view only polls. */
  readonly createEventSource: EventSourceFactory | null;
  readonly now: () => number;
  /** Subscribes to "the session ended" (any `401`); returns the unsubscribe function. */
  readonly onSessionExpired: (listener: () => void) => () => void;
  /** Opens the browser's print dialog (the sticker sheet). */
  readonly print: () => void;
}

export function createBrowserPanelDeps(): PanelDeps {
  const listeners = new Set<() => void>();
  const api = createPanelApi({
    fetch: (input, init) => fetch(input, init),
    onUnauthorized: () => listeners.forEach((listener) => listener()),
  });
  return {
    api,
    createEventSource: typeof EventSource === 'undefined' ? null : (url) => new EventSource(url),
    now: () => Date.now(),
    onSessionExpired: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    print: () => window.print(),
  };
}

export const PanelDepsContext = createContext<PanelDeps | null>(null);

let browserDeps: PanelDeps | null = null;

/** The provided dependencies, or the browser ones. */
export function usePanelDeps(): PanelDeps {
  const provided = useContext(PanelDepsContext);
  if (provided !== null) return provided;
  browserDeps ??= createBrowserPanelDeps();
  return browserDeps;
}
