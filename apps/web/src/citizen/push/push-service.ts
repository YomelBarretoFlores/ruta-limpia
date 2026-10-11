import { ApiError } from '../../shared/http';
import type { CitizenApi } from '../api/citizen-api';
import type { PushSubscriptionJson } from '../api/types';
import type { PushSupport } from './push-support';
import type { StoredSubscription, SubscriptionStore } from './subscription-store';

/** Version of the consent text the household accepts (recorded by the API). */
export const CONSENT_VERSION = '2026-10-v1';

/** The part of the browser `PushSubscription` used here. */
export interface PushSubscriptionLike {
  readonly options?: { readonly applicationServerKey: ArrayBuffer | null };
  toJSON(): unknown;
  unsubscribe(): Promise<boolean>;
}

/** The part of the browser `PushManager` used here. */
export interface PushManagerLike {
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: {
    userVisibleOnly: boolean;
    applicationServerKey: Uint8Array<ArrayBuffer>;
  }): Promise<PushSubscriptionLike>;
}

export type ActivationResult =
  | { readonly status: 'subscribed'; readonly subscription: StoredSubscription }
  | { readonly status: 'denied' }
  | { readonly status: 'unsupported' }
  /** The server has no VAPID keys (503). */
  | { readonly status: 'push_unavailable' }
  /** 422: for example `household_route_mismatch`, `unknown_household`, `unknown_point`. */
  | { readonly status: 'rejected'; readonly reason: string }
  | { readonly status: 'rate_limited' }
  | { readonly status: 'failed' };

export type CancellationResult = { readonly status: 'cancelled' } | { readonly status: 'failed' };

export interface ActivationRequest {
  readonly routeCode: string;
  readonly pointCode: string;
  readonly householdCode: string | null;
}

/** Web Push subscription of this browser to a reference point. */
export interface PushService {
  support(): PushSupport;
  /** The current subscription of this browser, if any. */
  current(): Promise<StoredSubscription | null>;
  /** Must be called from the click on "Activar avisos": it asks for the permission. */
  activate(request: ActivationRequest): Promise<ActivationResult>;
  cancel(): Promise<CancellationResult>;
}

export interface PushServiceOptions {
  readonly api: CitizenApi;
  readonly store: SubscriptionStore;
  readonly support: () => PushSupport;
  readonly requestPermission: () => Promise<NotificationPermission>;
  /** The push manager of the active service worker registration. */
  readonly pushManager: () => Promise<PushManagerLike>;
}

export function createPushService(options: PushServiceOptions): PushService {
  const { api, store } = options;
  return {
    support: options.support,
    current: () => store.load().catch(() => null),

    async activate({ routeCode, pointCode, householdCode }) {
      if (options.support() !== 'supported') return { status: 'unsupported' };
      // Asked only now, after the household's click (browsers block unsolicited prompts).
      const permission = await options.requestPermission().catch(() => 'denied' as const);
      if (permission !== 'granted') return { status: 'denied' };

      let browserSubscription: PushSubscriptionLike;
      try {
        const key = await api.getVapidPublicKey();
        browserSubscription = await subscribeBrowser(await options.pushManager(), key);
      } catch (error) {
        return failure(error);
      }

      try {
        const response = await api.subscribe({
          subscription: browserSubscription.toJSON() as PushSubscriptionJson,
          pointCode,
          routeCode,
          ...(householdCode === null ? {} : { householdCode }),
          consent: true,
          consentVersion: CONSENT_VERSION,
        });
        const subscription: StoredSubscription = {
          subscriptionId: response.subscriptionId,
          managementToken: response.managementToken,
          pointCode: response.point.code,
          routeCode: response.point.routeCode,
        };
        await store.save(subscription);
        return { status: 'subscribed', subscription };
      } catch (error) {
        return failure(error);
      }
    },

    async cancel() {
      const stored = await store.load().catch(() => null);
      if (stored !== null) {
        try {
          await api.cancelSubscription(stored.subscriptionId, stored.managementToken);
        } catch (error) {
          // 403/404: the server no longer knows this token; anything else may be temporary.
          const gone = error instanceof ApiError && (error.status === 403 || error.status === 404);
          if (!gone) return { status: 'failed' };
        }
      }
      try {
        const current = await (await options.pushManager()).getSubscription();
        await current?.unsubscribe();
      } catch {
        // The server side is cancelled; a leftover browser subscription receives nothing.
      }
      await store.clear().catch(() => undefined);
      return { status: 'cancelled' };
    },
  };
}

/** Reuses this browser's push subscription when it was made with the same VAPID key. */
async function subscribeBrowser(
  manager: PushManagerLike,
  publicKey: string,
): Promise<PushSubscriptionLike> {
  const applicationServerKey = base64UrlToBytes(publicKey);
  const existing = await manager.getSubscription();
  if (existing !== null) {
    const current = existing.options?.applicationServerKey;
    if (current != null && sameBytes(new Uint8Array(current), applicationServerKey))
      return existing;
    await existing.unsubscribe();
  }
  return manager.subscribe({ userVisibleOnly: true, applicationServerKey });
}

function failure(error: unknown): ActivationResult {
  if (!(error instanceof ApiError)) return { status: 'failed' };
  if (error.status === 503) return { status: 'push_unavailable' };
  if (error.status === 422) return { status: 'rejected', reason: error.code ?? 'unprocessable' };
  if (error.status === 429) return { status: 'rate_limited' };
  return { status: 'failed' };
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
