import { createContext, useContext } from 'react';

import { createCitizenApi, type CitizenApi } from './api/citizen-api';
import type { EventSourceFactory } from './live/live-connection';
import { createBrowserPushService, createBrowserSubscriptionStore } from './push/browser-push';
import type { PushService } from './push/push-service';
import { viewCredentialsOf } from './push/view-credentials';

/** What the citizen app needs from the outside world; tests provide fakes. */
export interface CitizenDeps {
  readonly api: CitizenApi;
  /** Null without `EventSource`: the live view polls instead. */
  readonly createEventSource: EventSourceFactory | null;
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  readonly now: () => number;
  readonly push: PushService;
  /**
   * The proof of this browser's alert subscription, linked to usage views; null when none or
   * unreadable. Never rejects.
   */
  readonly viewCredentials: () => Promise<{
    readonly subscriptionId: string;
    readonly managementToken: string;
  } | null>;
}

/** In-memory storage for browsers that block `localStorage`. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

function browserStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}

export function createBrowserCitizenDeps(): CitizenDeps {
  const api = createCitizenApi((input, init) => fetch(input, init));
  const push = createBrowserPushService(api, createBrowserSubscriptionStore());
  return {
    api,
    createEventSource: typeof EventSource === 'undefined' ? null : (url) => new EventSource(url),
    storage: browserStorage(),
    now: () => Date.now(),
    push,
    viewCredentials: viewCredentialsOf(push),
  };
}

export const CitizenDepsContext = createContext<CitizenDeps | null>(null);

let browserDeps: CitizenDeps | null = null;

/** The provided dependencies, or the browser ones. */
export function useCitizenDeps(): CitizenDeps {
  const provided = useContext(CitizenDepsContext);
  if (provided !== null) return provided;
  browserDeps ??= createBrowserCitizenDeps();
  return browserDeps;
}
