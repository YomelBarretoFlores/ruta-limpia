import type { SubscriberIdentity } from '../../alerts/application/subscription-service.js';
import type { ReferencePointLookup } from '../../routes/application/reference-point-lookup.js';
import type { Clock } from '../../shared/application/clock.js';
import type { Logger } from '../../shared/application/logger.js';

/** One app view ("consulta") to store: never an IP address or a user agent. */
export interface NewAppView {
  readonly pointId: string;
  readonly subscriptionId: string | null;
  readonly householdId: string | null;
  readonly viewedAt: Date;
}

/** Port: the app view log. */
export interface AppViewStore {
  record(view: NewAppView): Promise<void>;
}

/** Port: proves a subscription by its management token (the alerts context provides it). */
export interface SubscriberIdentification {
  identify(subscriptionId: string, managementToken: string): Promise<SubscriberIdentity | null>;
}

export interface RecordViewCommand {
  readonly pointCode: string;
  readonly routeCode?: string;
  readonly subscriptionId?: string;
  readonly managementToken?: string;
}

export type RecordViewResult = 'recorded' | 'unknown_point' | 'ambiguous_point';

export interface AppViewServiceDependencies {
  readonly points: ReferencePointLookup;
  readonly subscribers: SubscriberIdentification;
  readonly store: AppViewStore;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Logs that the citizen app showed a reference point, for the adoption indicator (households with
 * at least one view or alert received per week). A view is linked to a subscription and its
 * household only when the browser proves the subscription's management token; otherwise, also
 * with a wrong token, it is recorded as anonymous, so the endpoint never reveals whether a token
 * is valid.
 */
export class AppViewService {
  constructor(private readonly deps: AppViewServiceDependencies) {}

  async record(command: RecordViewCommand): Promise<RecordViewResult> {
    const points = await this.deps.points.findByCode(
      command.pointCode.trim().toUpperCase(),
      command.routeCode?.trim().toUpperCase(),
    );
    if (points.length === 0) return 'unknown_point';
    if (points.length > 1) return 'ambiguous_point';

    const subscriber =
      command.subscriptionId === undefined || command.managementToken === undefined
        ? null
        : await this.deps.subscribers.identify(command.subscriptionId, command.managementToken);
    await this.deps.store.record({
      pointId: points[0]!.id,
      subscriptionId: subscriber?.subscriptionId ?? null,
      householdId: subscriber?.householdId ?? null,
      viewedAt: this.deps.clock.now(),
    });
    this.deps.logger.debug(
      { pointCode: points[0]!.code, linked: subscriber !== null },
      'App view recorded',
    );
    return 'recorded';
  }
}
