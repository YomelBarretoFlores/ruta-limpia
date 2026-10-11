import type {
  Household,
  HouseholdDirectory,
} from '../../src/field/application/household-directory.js';
import type {
  PublicReferencePoint,
  ReferencePointLookup,
} from '../../src/routes/application/reference-point-lookup.js';
import type {
  AlertDeliveryStore,
  DeliveryCounts,
  NewDelivery,
  PushTarget,
} from '../../src/alerts/application/push-ports.js';
import type {
  ManagedSubscription,
  ManagementTokens,
  NewSubscription,
  RevokeReason,
  SubscriptionStore,
} from '../../src/alerts/application/subscription-ports.js';

export interface StoredSubscription extends NewSubscription {
  readonly id: string;
  revokedAt: Date | null;
  revokeReason: RevokeReason | null;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
}

export interface StoredDelivery extends NewDelivery {
  receivedAt: Date | null;
}

/**
 * In-memory subscription and delivery store with the database rules: unique endpoint (upsert keeps
 * the id), one delivery per (alert, subscription), counts recomputed from the deliveries.
 */
export class InMemorySubscriptionStore implements SubscriptionStore, AlertDeliveryStore {
  readonly subscriptions: StoredSubscription[] = [];
  readonly deliveries: StoredDelivery[] = [];
  readonly alertCounts = new Map<string, DeliveryCounts>();
  private nextId = 1;

  upsert(subscription: NewSubscription): Promise<{ id: string }> {
    const existing = this.subscriptions.find((s) => s.endpoint === subscription.endpoint);
    if (existing !== undefined) {
      Object.assign(existing, subscription, {
        revokedAt: null,
        revokeReason: null,
        consecutiveFailures: 0,
      });
      return Promise.resolve({ id: existing.id });
    }
    const stored: StoredSubscription = {
      ...subscription,
      id: `subscription-${this.nextId++}`,
      revokedAt: null,
      revokeReason: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
    };
    this.subscriptions.push(stored);
    return Promise.resolve({ id: stored.id });
  }

  findManaged(subscriptionId: string): Promise<ManagedSubscription | null> {
    const found = this.find(subscriptionId);
    return Promise.resolve(
      found === undefined
        ? null
        : {
            id: found.id,
            managementTokenHash: found.managementTokenHash,
            revokedAt: found.revokedAt,
          },
    );
  }

  revokeWithToken(
    subscriptionId: string,
    managementTokenHash: string,
    reason: RevokeReason,
    at: Date,
  ): Promise<boolean> {
    const found = this.find(subscriptionId);
    if (found?.managementTokenHash !== managementTokenHash) return Promise.resolve(false);
    return this.revoke(subscriptionId, reason, at).then(() => true);
  }

  revoke(subscriptionId: string, reason: RevokeReason, at: Date): Promise<void> {
    const found = this.find(subscriptionId);
    if (found !== undefined && found.revokedAt === null) {
      found.revokedAt = at;
      found.revokeReason = reason;
    }
    return Promise.resolve();
  }

  confirmReceipt(alertId: string, subscriptionId: string, at: Date): Promise<boolean> {
    const delivery = this.deliveries.find(
      (d) => d.alertId === alertId && d.subscriptionId === subscriptionId,
    );
    if (delivery === undefined) return Promise.resolve(false);
    delivery.receivedAt ??= at;
    return Promise.resolve(true);
  }

  activeTargets(pointId: string): Promise<PushTarget[]> {
    return Promise.resolve(
      this.subscriptions
        .filter((s) => s.pointId === pointId && s.revokedAt === null)
        .map((s) => ({
          subscriptionId: s.id,
          endpoint: s.endpoint,
          p256dh: s.p256dh,
          auth: s.auth,
        })),
    );
  }

  recordDelivery(delivery: NewDelivery): Promise<void> {
    const exists = this.deliveries.some(
      (d) => d.alertId === delivery.alertId && d.subscriptionId === delivery.subscriptionId,
    );
    if (!exists) this.deliveries.push({ ...delivery, receivedAt: null });
    return Promise.resolve();
  }

  markSuccess(subscriptionId: string, at: Date): Promise<void> {
    const found = this.find(subscriptionId);
    if (found !== undefined) Object.assign(found, { lastSuccessAt: at, consecutiveFailures: 0 });
    return Promise.resolve();
  }

  async markFailure(
    subscriptionId: string,
    maxConsecutiveFailures: number,
    at: Date,
  ): Promise<boolean> {
    const found = this.find(subscriptionId);
    if (found === undefined) return false;
    found.consecutiveFailures++;
    if (found.revokedAt !== null || found.consecutiveFailures < maxConsecutiveFailures)
      return false;
    await this.revoke(subscriptionId, 'too_many_failures', at);
    return true;
  }

  refreshAlertCounts(alertId: string): Promise<DeliveryCounts> {
    const of = this.deliveries.filter((d) => d.alertId === alertId);
    const counts = {
      recipients: of.length,
      delivered: of.filter((d) => d.status === 'sent').length,
      failed: of.filter((d) => d.status !== 'sent').length,
    };
    this.alertCounts.set(alertId, counts);
    return Promise.resolve(counts);
  }

  find(subscriptionId: string): StoredSubscription | undefined {
    return this.subscriptions.find((s) => s.id === subscriptionId);
  }
}

/** Deterministic tokens: `token-N`, hashed as `hash:token-N`. */
export class FakeManagementTokens implements ManagementTokens {
  private next = 1;

  issue(): { token: string; hash: string } {
    const token = `token-${this.next++}`;
    return { token, hash: `hash:${token}` };
  }

  matches(token: string, hash: string): boolean {
    return `hash:${token}` === hash;
  }
}

export class InMemoryReferencePoints implements ReferencePointLookup {
  constructor(private readonly points: readonly PublicReferencePoint[]) {}

  findById(pointId: string): Promise<PublicReferencePoint | null> {
    return Promise.resolve(this.points.find((p) => p.id === pointId) ?? null);
  }

  findByCode(pointCode: string, routeCode?: string): Promise<PublicReferencePoint[]> {
    return Promise.resolve(
      this.points.filter(
        (p) => p.code === pointCode && (routeCode === undefined || p.routeCode === routeCode),
      ),
    );
  }
}

export class InMemoryHouseholds implements HouseholdDirectory {
  constructor(private readonly households: readonly Household[]) {}

  findByCode(code: string): Promise<Household | null> {
    return Promise.resolve(this.households.find((h) => h.code === code) ?? null);
  }
}
