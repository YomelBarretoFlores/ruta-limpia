import type { PanelActor } from '../../auth/application/panel-actor.js';
import { can } from '../../auth/domain/role.js';
import type { RoutePointResolver } from '../../routes/application/route-point-resolver.js';
import type { AuditLog } from '../../shared/application/audit-log.js';
import type { Clock } from '../../shared/application/clock.js';
import type { UnitOfWork } from '../../shared/application/unit-of-work.js';
import {
  canReadFieldRecord,
  fieldEditVerdict,
  type FieldRecordOwnership,
} from '../domain/field-record-access.js';

/** The hand-written part of a baseline route log (Instrument 1 before alerts exist). */
export interface BaselineLogContent {
  /** `YYYY-MM-DD`, local date. */
  readonly serviceDate: string;
  readonly vehicleLabel: string | null;
  /** `HH:MM`, local time. */
  readonly plannedStart: string | null;
  readonly actualStart: string | null;
  readonly notes: string | null;
}

export interface BaselinePassRecord {
  readonly pointCode: string;
  readonly sequence: number;
  /** `HH:MM`, local time. */
  readonly passedAt: string;
}

export interface BaselineLogRecord extends BaselineLogContent, FieldRecordOwnership {
  readonly id: string;
  readonly routeCode: string;
  /** In route order. */
  readonly passes: readonly BaselinePassRecord[];
  readonly updatedAt: Date;
}

export interface StoredBaselineLog extends BaselineLogContent {
  readonly routeId: string;
  readonly passes: readonly { readonly pointId: string; readonly passedAt: string }[];
}

export interface BaselineLogFilter {
  readonly routeCode?: string;
  readonly from?: string;
  readonly to?: string;
  readonly createdByUserId?: string;
}

/** Port: baseline route logs with their point passes. */
export interface BaselineLogStore {
  insert(
    log: StoredBaselineLog,
    meta: { readonly createdByUserId: string; readonly at: Date },
  ): Promise<BaselineLogRecord>;
  findById(id: string): Promise<BaselineLogRecord | null>;
  /**
   * Replaces the content and every pass, atomically; null (and nothing written) when the log no
   * longer exists.
   */
  update(id: string, log: StoredBaselineLog, at: Date): Promise<BaselineLogRecord | null>;
  /** False when the log no longer exists. */
  delete(id: string): Promise<boolean>;
  list(
    filter: BaselineLogFilter,
    window: { readonly limit: number; readonly offset: number },
  ): Promise<{ readonly items: BaselineLogRecord[]; readonly total: number }>;
}

export interface BaselineLogCommand extends BaselineLogContent {
  readonly routeCode: string;
  readonly passes: readonly { readonly pointCode: string; readonly passedAt: string }[];
}

export type BaselineLogResult =
  | { readonly status: 'ok'; readonly log: BaselineLogRecord }
  | {
      readonly status:
        | 'unknown_route'
        | 'unknown_point'
        | 'duplicate_point'
        | 'not_found'
        | 'not_owner'
        | 'edit_window_closed';
      readonly pointCode?: string;
    };

/** The ports a log change writes through, in one transaction with its audit event. */
export interface BaselineLogTransaction {
  readonly store: BaselineLogStore;
  readonly audit: AuditLog;
}

export interface BaselineLogDependencies {
  /** Reads outside any transaction. */
  readonly store: BaselineLogStore;
  readonly transactions: UnitOfWork<BaselineLogTransaction>;
  readonly points: RoutePointResolver;
  readonly clock: Clock;
}

/**
 * Baseline Instrument 1 logs, with the same ownership rules as the observation sheets. Every
 * change commits together with its audit event; a log deleted while it was being edited answers
 * `not_found`.
 */
export class BaselineLogService {
  constructor(private readonly deps: BaselineLogDependencies) {}

  list(filter: BaselineLogFilter, window: { limit: number; offset: number }, actor: PanelActor) {
    const scoped = can(actor.role, 'field:read_all')
      ? filter
      : { ...filter, createdByUserId: actor.userId };
    return this.deps.store.list(scoped, window);
  }

  async get(id: string, actor: PanelActor): Promise<BaselineLogRecord | null> {
    const log = await this.deps.store.findById(id);
    return log !== null && canReadFieldRecord(actor.role, actor.userId, log) ? log : null;
  }

  async create(command: BaselineLogCommand, actor: PanelActor): Promise<BaselineLogResult> {
    const prepared = await this.prepare(command);
    if (prepared.status !== 'ok') return prepared;
    const now = this.deps.clock.now();
    return this.deps.transactions.run(async ({ store, audit }) => {
      const log = await store.insert(prepared.stored, { createdByUserId: actor.userId, at: now });
      await this.record(audit, 'baseline_log.created', actor, log);
      return { status: 'ok', log };
    });
  }

  async update(
    id: string,
    command: BaselineLogCommand,
    actor: PanelActor,
  ): Promise<BaselineLogResult> {
    const access = await this.editable(id, actor);
    if (access.status !== 'ok') return access;
    const prepared = await this.prepare(command);
    if (prepared.status !== 'ok') return prepared;
    return this.deps.transactions.run(async ({ store, audit }) => {
      const log = await store.update(id, prepared.stored, this.deps.clock.now());
      if (log === null) return { status: 'not_found' };
      await this.record(audit, 'baseline_log.updated', actor, log);
      return { status: 'ok', log };
    });
  }

  async delete(id: string, actor: PanelActor): Promise<BaselineLogResult> {
    const access = await this.editable(id, actor);
    if (access.status !== 'ok') return access;
    return this.deps.transactions.run(async ({ store, audit }) => {
      if (!(await store.delete(id))) return { status: 'not_found' };
      await this.record(audit, 'baseline_log.deleted', actor, access.log);
      return access;
    });
  }

  private async editable(id: string, actor: PanelActor): Promise<BaselineLogResult> {
    const log = await this.get(id, actor);
    if (log === null) return { status: 'not_found' };
    const verdict = fieldEditVerdict(actor.role, actor.userId, log, this.deps.clock.now());
    return verdict === 'allowed' ? { status: 'ok', log } : { status: verdict };
  }

  private async prepare(
    command: BaselineLogCommand,
  ): Promise<
    | { readonly status: 'ok'; readonly stored: StoredBaselineLog }
    | Exclude<BaselineLogResult, { status: 'ok' }>
  > {
    const route = await this.deps.points.resolve(command.routeCode);
    if (route.status !== 'ok') return { status: route.status };
    const seen = new Set<string>();
    const passes: { pointId: string; passedAt: string }[] = [];
    for (const pass of command.passes) {
      if (seen.has(pass.pointCode)) return { status: 'duplicate_point', pointCode: pass.pointCode };
      seen.add(pass.pointCode);
      const resolved = await this.deps.points.resolve(command.routeCode, pass.pointCode);
      if (resolved.status !== 'ok' || resolved.point === null) {
        return { status: 'unknown_point', pointCode: pass.pointCode };
      }
      passes.push({ pointId: resolved.point.id, passedAt: pass.passedAt });
    }
    return {
      status: 'ok',
      stored: {
        routeId: route.routeId,
        serviceDate: command.serviceDate,
        vehicleLabel: command.vehicleLabel,
        plannedStart: command.plannedStart,
        actualStart: command.actualStart,
        notes: command.notes,
        passes,
      },
    };
  }

  private async record(
    audit: AuditLog,
    action: string,
    actor: PanelActor,
    log: BaselineLogRecord,
  ): Promise<void> {
    await audit.record({
      userId: actor.userId,
      action,
      entity: 'baseline_log',
      entityId: log.id,
      at: this.deps.clock.now(),
      details: {
        routeCode: log.routeCode,
        serviceDate: log.serviceDate,
        passes: log.passes.length,
      },
    });
  }
}
