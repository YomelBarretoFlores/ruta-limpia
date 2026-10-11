import type { PanelActor } from '../../auth/application/panel-actor.js';
import type { RoutePointResolver } from '../../routes/application/route-point-resolver.js';
import type { AuditLog } from '../../shared/application/audit-log.js';
import type { Clock } from '../../shared/application/clock.js';
import type { UnitOfWork } from '../../shared/application/unit-of-work.js';
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
   * serialized, so two households never get the same code, and a code is never handed out again
   * after its household is deleted.
   */
  insertWithNextCode(household: NewHousehold): Promise<HouseholdRecord>;
  findByCode(code: string): Promise<HouseholdRecord | null>;
  /**
   * Reads the household and locks its row until the transaction ends, so a change diffs against
   * the version it replaces (use inside a transaction).
   */
  findByCodeForUpdate(code: string): Promise<HouseholdRecord | null>;
  /** Null when the household no longer exists (deleted meanwhile). */
  update(
    id: string,
    changes: {
      readonly pointId?: string;
      readonly active?: boolean;
      readonly notes?: string | null;
    },
    at: Date,
  ): Promise<HouseholdRecord | null>;
  /** False when the household no longer exists. */
  delete(id: string): Promise<boolean>;
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

/** The ports a registry change writes through, in one transaction with its audit event. */
export interface HouseholdRegistryTransaction {
  readonly store: HouseholdStore;
  readonly audit: AuditLog;
}

export interface HouseholdRegistryDependencies {
  /** Reads outside any transaction. */
  readonly store: HouseholdStore;
  readonly transactions: UnitOfWork<HouseholdRegistryTransaction>;
  readonly points: RoutePointResolver;
  readonly clock: Clock;
}

/**
 * Door-to-door household enrollment and its follow-up from the panel. Every change commits
 * together with its audit event.
 */
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
    const pointId = resolved.point.id;
    const now = this.deps.clock.now();
    return this.deps.transactions.run(async ({ store, audit }) => {
      const household = await store.insertWithNextCode({
        routeId: resolved.routeId,
        pointId,
        enrolledAt: now,
        consentAt: command.consentAt ?? now,
        consentVersion: command.consentVersion ?? DEFAULT_ENROLLMENT_CONSENT_VERSION,
        notes: command.notes ?? null,
        createdByUserId: actor.userId,
      });
      await this.record(audit, 'household.created', actor, household.code, {
        routeCode: household.routeCode,
        pointCode: household.pointCode,
      });
      return { status: 'ok', household };
    });
  }

  async update(
    code: string,
    command: UpdateHouseholdCommand,
    actor: PanelActor,
  ): Promise<HouseholdResult> {
    return this.deps.transactions.run(async ({ store, audit }) => {
      // Diff against the locked row, not an earlier read: a concurrent change may have committed
      // in between, and a stale "nothing to change" would answer with a record that is not stored.
      const current = await store.findByCodeForUpdate(code);
      if (current === null) return { status: 'not_found' };
      const changesPoint =
        command.pointCode !== undefined && command.pointCode !== current.pointCode;
      let point: { readonly id: string; readonly code: string } | undefined;
      if (changesPoint) {
        // Only a new point is resolved: echoing the stored one back (a form saving every field)
        // must not fail because that point was retired since. A household stays on its route.
        const resolved = await this.deps.points.resolve(current.routeCode, command.pointCode);
        if (resolved.status !== 'ok' || resolved.point === null) return { status: 'unknown_point' };
        point = { id: resolved.point.id, code: resolved.point.code };
      }
      const changesActive = command.active !== undefined && command.active !== current.active;
      const changesNotes = command.notes !== undefined && command.notes !== current.notes;
      const fields = [
        ...(changesPoint ? ['pointCode'] : []),
        ...(changesActive ? ['active'] : []),
        ...(changesNotes ? ['notes'] : []),
      ];
      // Nothing differs from the stored version: nothing is written and nothing is audited.
      if (fields.length === 0) return { status: 'ok', household: current };

      const household = await store.update(
        current.id,
        {
          ...(changesPoint ? { pointId: point?.id } : {}),
          ...(changesActive ? { active: command.active } : {}),
          ...(changesNotes ? { notes: command.notes } : {}),
        },
        this.deps.clock.now(),
      );
      if (household === null) return { status: 'not_found' };
      await this.record(audit, 'household.updated', actor, code, {
        fields,
        ...(changesPoint ? { pointCode: household.pointCode } : {}),
        ...(changesActive ? { active: household.active } : {}),
      });
      return { status: 'ok', household };
    });
  }

  async remove(code: string, actor: PanelActor): Promise<boolean> {
    const current = await this.deps.store.findByCode(code);
    if (current === null) return false;
    return this.deps.transactions.run(async ({ store, audit }) => {
      if (!(await store.delete(current.id))) return false;
      await this.record(audit, 'household.deleted', actor, code, { routeCode: current.routeCode });
      return true;
    });
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
    audit: AuditLog,
    action: string,
    actor: PanelActor,
    code: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await audit.record({
      userId: actor.userId,
      action,
      entity: 'household',
      entityId: code,
      at: this.deps.clock.now(),
      details,
    });
  }
}
