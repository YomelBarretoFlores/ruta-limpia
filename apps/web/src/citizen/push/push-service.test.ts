import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../shared/http';
import { fakeApi } from '../test/fake-deps';
import {
  base64UrlToBytes,
  CONSENT_VERSION,
  createPushService,
  type PushManagerLike,
  type PushSubscriptionLike,
} from './push-service';
import { detectPushSupport, type PushCapabilities } from './push-support';
import { createSubscriptionStore } from './subscription-store';

const VAPID_KEY = 'BOrH0Dz9DJQqk_2bS2AG5h2DuYQWhPrYQ5wmfWT3w2Kc';
const SUBSCRIPTION_JSON = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

function browserSubscription(key: string = VAPID_KEY) {
  return {
    options: { applicationServerKey: base64UrlToBytes(key).buffer },
    toJSON: () => SUBSCRIPTION_JSON,
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  } satisfies PushSubscriptionLike;
}

function setup(existing: PushSubscriptionLike | null = null) {
  const api = fakeApi();
  api.getVapidPublicKey.mockResolvedValue(VAPID_KEY);
  api.subscribe.mockResolvedValue({
    subscriptionId: 'sub-1',
    managementToken: 'token-1',
    point: { id: 'p8', code: 'P08', name: 'Parque Ginebra', routeCode: 'RI-01' },
  });
  const created = browserSubscription();
  const manager = {
    getSubscription: vi.fn(() => Promise.resolve(existing)),
    subscribe: vi.fn<PushManagerLike['subscribe']>(() => Promise.resolve(created)),
  };
  const store = createSubscriptionStore(new IDBFactory());
  const requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('granted'));
  const service = createPushService({
    api,
    store,
    support: () => 'supported',
    requestPermission,
    pushManager: () => Promise.resolve(manager),
  });
  const request = { routeCode: 'RI-01', pointCode: 'P08', householdCode: 'H-001' };
  return { api, manager, store, requestPermission, service, request, created };
}

describe('PushService.activate', () => {
  it('asks permission, subscribes with the VAPID key and stores the credentials', async () => {
    const { api, manager, store, service, request } = setup();

    const result = await service.activate(request);

    const stored = {
      subscriptionId: 'sub-1',
      managementToken: 'token-1',
      pointCode: 'P08',
      routeCode: 'RI-01',
    };
    expect(result).toEqual({ status: 'subscribed', subscription: stored });
    expect(manager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(VAPID_KEY),
    });
    expect(api.subscribe).toHaveBeenCalledWith({
      subscription: SUBSCRIPTION_JSON,
      pointCode: 'P08',
      routeCode: 'RI-01',
      householdCode: 'H-001',
      consent: true,
      consentVersion: CONSENT_VERSION,
    });
    expect(await store.load()).toEqual(stored);
    expect(await service.current()).toEqual(stored);
  });

  it('stops when the permission is not granted', async () => {
    const { api, requestPermission, service, request } = setup();
    requestPermission.mockResolvedValue('denied');

    expect(await service.activate(request)).toEqual({ status: 'denied' });
    expect(api.getVapidPublicKey).not.toHaveBeenCalled();
  });

  it('reuses a browser subscription made with the same key and replaces one with another key', async () => {
    const same = setup(browserSubscription());
    await same.service.activate(same.request);
    expect(same.manager.subscribe).not.toHaveBeenCalled();

    const old = browserSubscription('AAAA');
    const other = setup(old);
    await other.service.activate(other.request);
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(other.manager.subscribe).toHaveBeenCalled();
  });

  it.each([
    [new ApiError(503, 'push_unavailable'), { status: 'push_unavailable' }],
    [
      new ApiError(422, 'household_route_mismatch'),
      { status: 'rejected', reason: 'household_route_mismatch' },
    ],
    [new ApiError(429, null), { status: 'rate_limited' }],
    [new TypeError('Failed to fetch'), { status: 'failed' }],
  ])('maps %o to %o without storing anything', async (error, expected) => {
    const { api, store, service, request } = setup();
    api.subscribe.mockRejectedValue(error);

    expect(await service.activate(request)).toEqual(expected);
    expect(await store.load()).toBeNull();
  });

  it('reports push as unavailable when the VAPID key is missing', async () => {
    const { api, service, request } = setup();
    api.getVapidPublicKey.mockRejectedValue(new ApiError(503, 'push_unavailable'));

    expect(await service.activate(request)).toEqual({ status: 'push_unavailable' });
  });
});

describe('PushService.cancel', () => {
  it('cancels on the server with the token, then unsubscribes the browser', async () => {
    const existing = browserSubscription();
    const { api, store, service, request } = setup(existing);
    await service.activate(request);

    expect(await service.cancel()).toEqual({ status: 'cancelled' });
    expect(api.cancelSubscription).toHaveBeenCalledWith('sub-1', 'token-1');
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(api.cancelSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      existing.unsubscribe.mock.invocationCallOrder[0]!,
    );
    expect(await store.load()).toBeNull();
  });

  it('keeps everything when the server cannot be reached', async () => {
    const existing = browserSubscription();
    const { api, store, service, request } = setup(existing);
    await service.activate(request);
    api.cancelSubscription.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await service.cancel()).toEqual({ status: 'failed' });
    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(await store.load()).not.toBeNull();
  });

  it('clears a subscription the server no longer knows', async () => {
    const { api, store, service, request } = setup();
    await service.activate(request);
    api.cancelSubscription.mockRejectedValue(new ApiError(404, 'not_found'));

    expect(await service.cancel()).toEqual({ status: 'cancelled' });
    expect(await store.load()).toBeNull();
  });
});

describe('detectPushSupport', () => {
  const android: PushCapabilities = {
    userAgent: 'Mozilla/5.0 (Linux; Android 13) Chrome/129.0 Mobile Safari/537.36',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    standalone: false,
    serviceWorker: true,
    pushManager: true,
    notification: true,
  };
  const iphone = {
    ...android,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Safari',
    platform: 'iPhone',
  };

  it('supports push in Android browsers', () => {
    expect(detectPushSupport(android)).toBe('supported');
    expect(detectPushSupport({ ...android, pushManager: false })).toBe('unsupported');
  });

  it('asks iPhone and iPad users to install the app first', () => {
    expect(detectPushSupport(iphone)).toBe('ios_install');
    expect(
      detectPushSupport({ ...android, userAgent: 'Macintosh Safari', platform: 'MacIntel' }),
    ).toBe('ios_install');
    expect(detectPushSupport({ ...iphone, standalone: true })).toBe('supported');
  });
});
