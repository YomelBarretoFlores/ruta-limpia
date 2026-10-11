import { vi } from 'vitest';

import type { CitizenApi } from '../api/citizen-api';
import type { LiveSnapshot } from '../api/types';
import type { CitizenDeps } from '../citizen-deps';
import { ROUTE, snapshot } from './fixtures';

/** A fake citizen API serving `ROUTE` and the given live snapshot. */
export function fakeApi(live: LiveSnapshot = snapshot()) {
  return {
    listRoutes: vi.fn<CitizenApi['listRoutes']>(() => Promise.resolve([ROUTE])),
    getRoute: vi.fn<CitizenApi['getRoute']>(() => Promise.resolve(ROUTE)),
    getLiveSnapshot: vi.fn<CitizenApi['getLiveSnapshot']>(() => Promise.resolve(live)),
    liveStreamUrl: vi.fn<CitizenApi['liveStreamUrl']>((code) => `/api/live/routes/${code}/stream`),
    getVapidPublicKey: vi.fn<CitizenApi['getVapidPublicKey']>(() => Promise.resolve('key')),
    subscribe: vi.fn<CitizenApi['subscribe']>(),
    cancelSubscription: vi.fn<CitizenApi['cancelSubscription']>(() => Promise.resolve()),
    recordView: vi.fn<CitizenApi['recordView']>(() => Promise.resolve()),
  } satisfies CitizenApi;
}

export function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

export type FakeApi = ReturnType<typeof fakeApi>;
export type FakeStorage = ReturnType<typeof fakeStorage>;

/** Dependencies without network: no `EventSource`, so the live view polls the fake API. */
export function fakeDeps(
  overrides: Partial<Omit<CitizenDeps, 'api' | 'storage'>> & {
    api?: FakeApi;
    storage?: FakeStorage;
  } = {},
) {
  return {
    createEventSource: null,
    now: () => 0,
    viewCredentials: () => Promise.resolve(null),
    ...overrides,
    api: overrides.api ?? fakeApi(),
    storage: overrides.storage ?? fakeStorage(),
  } satisfies CitizenDeps;
}
