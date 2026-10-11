import type { HouseholdDirectory } from '../../field/application/household-directory.js';
import type {
  PublicReferencePoint,
  ReferencePointLookup,
} from '../../routes/application/reference-point-lookup.js';
import type { Clock } from '../../shared/application/clock.js';
import type { Logger } from '../../shared/application/logger.js';
import { isAllowedPushEndpoint } from '../domain/push-endpoint.js';
import type { ManagementTokens, PushEndpoint, SubscriptionStore } from './subscription-ports.js';

/** The point to follow: by id, or by its public code (plus the route code when codes repeat). */
export type PointSelector =
  { readonly pointId: string } | { readonly pointCode: string; readonly routeCode?: string };

export interface SubscribeCommand {
  readonly subscription: PushEndpoint;
  readonly point: PointSelector;
  readonly householdCode: string | null;
  /** Version of the consent text the citizen accepted. Consent itself is checked by the caller. */
  readonly consentVersion: string;
}

export type SubscribeResult =
  | {
      readonly status: 'subscribed';
      readonly subscriptionId: string;
      /** Returned once; only its hash is stored. */
      readonly managementToken: string;
      readonly point: PublicReferencePoint;
    }
  | { readonly status: 'unsupported_push_service' }
  | { readonly status: 'unknown_point' }
  | { readonly status: 'ambiguous_point' }
  | { readonly status: 'unknown_household' };

export type CancelResult = 'cancelled' | 'not_found' | 'forbidden';

export interface SubscriptionServiceDependencies {
  readonly store: SubscriptionStore;
  readonly points: ReferencePointLookup;
  readonly households: HouseholdDirectory;
  readonly tokens: ManagementTokens;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Push service hosts endpoints may point to; defaults to the browser push services. */
  readonly allowedPushHosts?: readonly string[];
}

/**
 * Citizen subscriptions to one public reference point, with explicit consent. A subscription is
 * managed (cancelled) with the token returned at subscription time; no account is involved.
 */
export class SubscriptionService {
  constructor(private readonly deps: SubscriptionServiceDependencies) {}

  async subscribe(command: SubscribeCommand): Promise<SubscribeResult> {
    if (!isAllowedPushEndpoint(command.subscription.endpoint, this.deps.allowedPushHosts)) {
      return { status: 'unsupported_push_service' };
    }
    const points = await this.findPoints(command.point);
    if (points.length === 0) return { status: 'unknown_point' };
    if (points.length > 1) return { status: 'ambiguous_point' };
    const point = points[0]!;

    let householdId: string | null = null;
    if (command.householdCode !== null) {
      const household = await this.deps.households.findByCode(
        command.householdCode.trim().toUpperCase(),
      );
      if (household === null || !household.active) return { status: 'unknown_household' };
      householdId = household.id;
    }

    const { token, hash } = this.deps.tokens.issue();
    const { id } = await this.deps.store.upsert({
      ...command.subscription,
      pointId: point.id,
      householdId,
      consentAt: this.deps.clock.now(),
      consentVersion: command.consentVersion,
      managementTokenHash: hash,
    });
    this.deps.logger.info(
      { subscriptionId: id, pointCode: point.code, routeCode: point.routeCode },
      'Push subscription saved',
    );
    return { status: 'subscribed', subscriptionId: id, managementToken: token, point };
  }

  /** Revokes the subscription (reason `user_cancelled`). Cancelling twice is not an error. */
  async cancel(subscriptionId: string, managementToken: string): Promise<CancelResult> {
    const subscription = await this.deps.store.findManaged(subscriptionId);
    if (subscription === null) return 'not_found';
    if (!this.deps.tokens.matches(managementToken, subscription.managementTokenHash)) {
      return 'forbidden';
    }
    if (subscription.revokedAt === null) {
      await this.deps.store.revoke(subscriptionId, 'user_cancelled', this.deps.clock.now());
      this.deps.logger.info({ subscriptionId }, 'Push subscription cancelled');
    }
    return 'cancelled';
  }

  private async findPoints(selector: PointSelector): Promise<PublicReferencePoint[]> {
    if ('pointId' in selector) {
      const point = await this.deps.points.findById(selector.pointId);
      return point === null ? [] : [point];
    }
    return this.deps.points.findByCode(
      selector.pointCode.trim().toUpperCase(),
      selector.routeCode?.trim().toUpperCase(),
    );
  }
}
