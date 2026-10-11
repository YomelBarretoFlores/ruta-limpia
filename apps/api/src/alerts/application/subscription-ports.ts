/** What the browser's `PushSubscription.toJSON()` gives: the endpoint and its encryption keys. */
export interface PushEndpoint {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export type RevokeReason = 'user_cancelled' | 'expired' | 'too_many_failures';

export interface NewSubscription extends PushEndpoint {
  readonly pointId: string;
  readonly householdId: string | null;
  readonly consentAt: Date;
  readonly consentVersion: string;
  readonly managementTokenHash: string;
}

/** The fields needed to authorize a subscription's management (cancel, receipts). */
export interface ManagedSubscription {
  readonly id: string;
  readonly managementTokenHash: string;
  readonly revokedAt: Date | null;
  readonly householdId: string | null;
}

/** Port: persists Web Push subscriptions. */
export interface SubscriptionStore {
  /**
   * Inserts the subscription, or updates the one with the same endpoint (new point, keys, consent
   * and token; reactivated if it was revoked) and keeps its id.
   */
  upsert(subscription: NewSubscription): Promise<{ readonly id: string }>;
  findManaged(subscriptionId: string): Promise<ManagedSubscription | null>;
  /**
   * Revokes the subscription (soft delete) only while its management token hash is still
   * `managementTokenHash`, in one atomic step: a concurrent re-subscription of the same endpoint
   * rotates the token and reactivates the row, and the old token must not revoke it then. An
   * already revoked subscription keeps its time and reason. Returns false when the hash no longer
   * matches (nothing changed).
   */
  revokeWithToken(
    subscriptionId: string,
    managementTokenHash: string,
    reason: RevokeReason,
    at: Date,
  ): Promise<boolean>;
  /**
   * Sets `received_at` on the (alert, subscription) delivery unless already set. Returns false when
   * there is no such delivery.
   */
  confirmReceipt(alertId: string, subscriptionId: string, at: Date): Promise<boolean>;
}

/** Port: issues management tokens and checks them against their stored hash. */
export interface ManagementTokens {
  issue(): { readonly token: string; readonly hash: string };
  /** Constant-time comparison of the token's hash with `hash`. */
  matches(token: string, hash: string): boolean;
}
