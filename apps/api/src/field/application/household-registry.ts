import type { PanelActor } from '../../auth/application/panel-actor.js';
import type { RoutePointResolver } from '../../routes/application/route-point-resolver.js';
import type { AuditLog } from '../../shared/application/audit-log.js';
import type { Clock } from '../../shared/application/clock.js';
import { householdStickerUrl } from '../domain/household-code.js';

/** Consent text version recorded when the panel does not give one (door-to-door enrollment). */
export const DEFAULT_ENROLLMENT_CONSENT_VERSION = 'enrollment-2026-10';

/** An enrolled household: a code and a public reference point; never an address, name or phone. */
export interface HouseholdRecord {
  readonly id: string;
  readonly code: string;
  readonly routeId: string;
  readonly routeCode: string;
  readonly pointCode: string;
  readonly enrolledAt: Date;
  readonly consentAt: Date;
  readonly consentVersion: string;
  readonly active: boolean;
  readonly notes: string | null;
  readonly updatedAt: Date;
}

/** A household with how it uses the alerts (for the adoption follow-up). */
export interface HouseholdListItem extends HouseholdRecord {
  readonly activeSubscriptions: number;
  readonly lastAlertReceivedAt: Date | null;
  readonly lastAppViewAt: Date | null;
}

export interface NewHousehold {
  readonly routeId: string;
  readonly pointId: string;
  readonly enrolledAt: Date;
  readonly consentAt: Date;
  readonly consentVersion: string;
  readonly notes: string | null;
  readonly createdByUserId: string;
}

export interface HouseholdFilter {
  readonly routeCode?: string;
  readonly pointCode?: string;
  readonly active?: boolean;
}

/** Port: the household registry. */
export interface HouseholdStore {
  /**
   * Inserts the household with the next generated code (`H-###`). Concurrent enrollments are
   * serialized, so two households never get the same code.
   */
  insertWithNextCode(household: NewHousehold): Promise<HouseholdRecord>;
  findByCode(code: string): Promise<HouseholdRecord | null>;
  update(
    id: string,
    changes: {
      readonly pointId?: string;
      readonly active?: boolean;
      readonly notes?: string | null;
    },
    at: Date,
  ): Promise<HouseholdRecord>;
  delete(id: string): Promise<void>;
  list(
    filter: HouseholdFilter,
    window: { readonly limit: number; readonly offset: number },
  ): Promise<{ readonly items: HouseholdListItem[]; readonly total: number }>;
}

export interface EnrollCommand {
  readonly routeCode: string;
  readonly pointCode: string;
  readonly consentAt?: Date;
  readonly consentVersion?: string;
  readonly notes?: string;
}

export interface UpdateHouseholdCommand {
  readonly pointCode?: string;
  readonly active?: boolean;
  readonly notes?: string | null;
}

export type HouseholdResult =
  | { readonly status: 'ok'; readonly household: HouseholdRecord }
  | { readonly status: 'unknown_route' | 'unknown_point' | 'not_found' };

export interface HouseholdRegistryDependencies {
  readonly store: HouseholdStore;
  readonly points: RoutePointResolver;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

/** Door-to-door household enrollment and its follow-up from the panel (audited). */
export class HouseholdRegistryService {
  constructor(private readonly deps: HouseholdRegistryDependencies) {}

  list(filter: HouseholdFilter, window: { limit: number; offset: number }) {
    return this.deps.store.list(filter, window);
  }

  async find(code: string): Promise<HouseholdRecord | null> {
    return this.deps.store.findByCode(code);
  }

  async enroll(command: EnrollCommand, actor: PanelActor): Promise<HouseholdResult> {
    const resolved = await this.deps.points.resolve(command.routeCode, command.pointCode);
    if (resolved.status !== 'ok' || resolved.point === null) {
      return { status: resolved.status === 'ok' ? 'unknown_point' : resolved.status };
    }
    const now = this.deps.clock.now();
    const household = await this.deps.store.insertWithNextCode({
      routeId: resolved.routeId,
      pointId: resolved.point.id,
      enrolledAt: now,
      consentAt: command.consentAt ?? now,
      consentVersion: command.consentVersion ?? DEFAULT_ENROLLMENT_CONSENT_VERSION,
      notes: command.notes ?? null,
      createdByUserId: actor.userId,
    });
    await this.record('household.created', actor, household.code, {
      routeCode: household.routeCode,
      pointCode: household.pointCode,
    });
    return { status: 'ok', household };
  }

  async update(
    code: string,
    command: UpdateHouseholdCommand,
    actor: PanelActor,
  ): Promise<HouseholdResult> {
    const current = await this.deps.store.findByCode(code);
    if (current === null) return { status: 'not_found' };
    let pointId: string | undefined;
    if (command.pointCode !== undefined) {
      // A household stays on its route: a new point must belong to it.
      const resolved = await this.deps.points.resolve(current.routeCode, command.pointCode);
      if (resolved.status !== 'ok' || resolved.point === null) return { status: 'unknown_point' };
      pointId = resolved.point.id;
    }
    const household = await this.deps.store.update(
      current.id,
      {
        ...(pointId === undefined ? {} : { pointId }),
        ...(command.active === undefined ? {} : { active: command.active }),
        ...(command.notes === undefined ? {} : { notes: command.notes }),
      },
      this.deps.clock.now(),
    );
    await this.record('household.updated', actor, code, {
      fields: Object.keys(command),
      ...(command.pointCode === undefined ? {} : { pointCode: household.pointCode }),
      ...(command.active === undefined ? {} : { active: household.active }),
    });
    return { status: 'ok', household };
  }

  async remove(code: string, actor: PanelActor): Promise<boolean> {
    const current = await this.deps.store.findByCode(code);
    if (current === null) return false;
    await this.deps.store.delete(current.id);
    await this.record('household.deleted', actor, code, { routeCode: current.routeCode });
    return true;
  }

  async sticker(
    code: string,
    origin: string,
  ): Promise<{ readonly code: string; readonly url: string } | null> {
    const household = await this.deps.store.findByCode(code);
    return household === null
      ? null
      : { code: household.code, url: householdStickerUrl(origin, household) };
  }

  private async record(
    action: string,
    actor: PanelActor,
    code: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.audit.record({
      userId: actor.userId,
      action,
      entity: 'household',
      entityId: code,
      at: this.deps.clock.now(),
      details,
    });
  }
}
