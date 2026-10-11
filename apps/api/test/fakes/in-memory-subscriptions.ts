import type {
  Household,
  HouseholdDirectory,
} from '../../src/field/application/household-directory.js';
import type {
  PublicReferencePoint,
  ReferencePointLookup,
} from '../../src/routes/application/reference-point-lookup.js';
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

/** In-memory SubscriptionStore with the database rules: unique endpoint, upsert keeps the id. */
export class InMemorySubscriptionStore implements SubscriptionStore {
  readonly subscriptions: StoredSubscription[] = [];
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

  revoke(subscriptionId: string, reason: RevokeReason, at: Date): Promise<void> {
    const found = this.find(subscriptionId);
    if (found !== undefined && found.revokedAt === null) {
      found.revokedAt = at;
      found.revokeReason = reason;
    }
    return Promise.resolve();
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
