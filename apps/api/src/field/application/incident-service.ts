import type { PanelActor } from '../../auth/application/panel-actor.js';
import type { RoutePointResolver } from '../../routes/application/route-point-resolver.js';
import type { AuditLog } from '../../shared/application/audit-log.js';
import type { Clock } from '../../shared/application/clock.js';
import type { UnitOfWork } from '../../shared/application/unit-of-work.js';
import type { IncidentKind } from '../domain/incident.js';

export interface IncidentRecord {
  readonly id: string;
  readonly kind: IncidentKind;
  readonly routeCode: string;
  readonly tripId: string | null;
  readonly pointCode: string | null;
  readonly description: string;
  readonly occurredAt: Date;
  /** The reporter's display name when the incident was recorded. */
  readonly reportedBy: string;
  readonly reportedByUserId: string | null;
  readonly resolvedAt: Date | null;
  readonly resolvedByUserId: string | null;
  readonly resolutionNote: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewIncident {
  readonly kind: IncidentKind;
  readonly routeId: string;
  readonly tripId: string | null;
  readonly pointId: string | null;
  readonly description: string;
  readonly occurredAt: Date;
  readonly reportedByUserId: string;
}

export interface IncidentChanges {
  readonly kind?: IncidentKind;
  readonly description?: string;
  /** Sets or clears the resolution (time, user and note). */
  readonly resolution?: {
    readonly at: Date;
    readonly userId: string;
    readonly note: string | null;
  } | null;
}

export interface IncidentFilter {
  readonly routeCode?: string;
  readonly tripId?: string;
  readonly kind?: IncidentKind;
  readonly status?: 'open' | 'resolved';
  /** Local dates (America/Lima) of `occurredAt`, inclusive. */
  readonly from?: string;
  readonly to?: string;
}

/** Port: the incident log. */
export interface IncidentStore {
  insert(incident: NewIncident): Promise<IncidentRecord>;
  findById(id: string): Promise<IncidentRecord | null>;
  /**
   * Locks the incident's row until the transaction ends (use inside a transaction), so two
   * concurrent edits diff against the versions they really replace. False when it does not exist.
   */
  lock(id: string): Promise<boolean>;
  update(id: string, changes: IncidentChanges, at: Date): Promise<IncidentRecord | null>;
  list(
    filter: IncidentFilter,
    window: { readonly limit: number; readonly offset: number },
  ): Promise<{ readonly items: IncidentRecord[]; readonly total: number }>;
  /** The route of a trip, or null when the trip does not exist. */
  routeOfTrip(tripId: string): Promise<string | null>;
}

export interface CreateIncidentCommand {
  readonly kind: IncidentKind;
  readonly routeCode: string;
  readonly pointCode?: string;
  readonly tripId?: string;
  readonly occurredAt?: Date;
  readonly description?: string;
}

export interface UpdateIncidentCommand {
  readonly kind?: IncidentKind;
  readonly description?: string;
  readonly resolved?: boolean;
  readonly resolutionNote?: string;
}

export type IncidentResult =
  | { readonly status: 'ok'; readonly incident: IncidentRecord }
  | {
      readonly status:
        'unknown_route' | 'unknown_point' | 'unknown_trip' | 'trip_route_mismatch' | 'not_found';
    };

/** The ports an incident change writes through, in one transaction with its audit event. */
export interface IncidentTransaction {
  readonly store: IncidentStore;
  readonly audit: AuditLog;
}

export interface IncidentServiceDependencies {
  /** Reads outside any transaction. */
  readonly store: IncidentStore;
  readonly transactions: UnitOfWork<IncidentTransaction>;
  readonly points: RoutePointResolver;
  readonly clock: Clock;
}

/**
 * The panel's incident log: report, list, edit and resolve. Every change commits together with
 * its audit event.
 */
export class IncidentService {
  constructor(private readonly deps: IncidentServiceDependencies) {}

  list(filter: IncidentFilter, window: { limit: number; offset: number }) {
    return this.deps.store.list(filter, window);
  }

  async create(command: CreateIncidentCommand, actor: PanelActor): Promise<IncidentResult> {
    const resolved = await this.deps.points.resolve(command.routeCode, command.pointCode);
    if (resolved.status !== 'ok') return { status: resolved.status };
    if (command.tripId !== undefined) {
      const tripRoute = await this.deps.store.routeOfTrip(command.tripId);
      if (tripRoute === null) return { status: 'unknown_trip' };
      if (tripRoute !== resolved.routeId) return { status: 'trip_route_mismatch' };
    }
    const now = this.deps.clock.now();
    return this.deps.transactions.run(async ({ store, audit }) => {
      const incident = await store.insert({
        kind: command.kind,
        routeId: resolved.routeId,
        tripId: command.tripId ?? null,
        pointId: resolved.point?.id ?? null,
        description: command.description ?? '',
        occurredAt: command.occurredAt ?? now,
        reportedByUserId: actor.userId,
      });
      await this.record(audit, 'incident.created', actor, incident.id, {
        kind: incident.kind,
        routeCode: incident.routeCode,
        pointCode: incident.pointCode,
        tripId: incident.tripId,
      });
      return { status: 'ok', incident };
    });
  }

  async update(
    id: string,
    command: UpdateIncidentCommand,
    actor: PanelActor,
  ): Promise<IncidentResult> {
    const now = this.deps.clock.now();
    const changes: IncidentChanges = {
      ...(command.kind === undefined ? {} : { kind: command.kind }),
      ...(command.description === undefined ? {} : { description: command.description }),
      ...(command.resolved === undefined
        ? {}
        : {
            resolution: command.resolved
              ? { at: now, userId: actor.userId, note: command.resolutionNote ?? null }
              : null,
          }),
    };
    return this.deps.transactions.run(async ({ store, audit }) => {
      const before = (await store.lock(id)) ? await store.findById(id) : null;
      const incident = before === null ? null : await store.update(id, changes, now);
      if (before === null || incident === null) return { status: 'not_found' };
      await this.record(
        audit,
        command.resolved === true ? 'incident.resolved' : 'incident.updated',
        actor,
        id,
        { fields: changedFields(before, incident) },
      );
      return { status: 'ok', incident };
    });
  }

  private async record(
    audit: AuditLog,
    action: string,
    actor: PanelActor,
    entityId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await audit.record({
      userId: actor.userId,
      action,
      entity: 'incident',
      entityId,
      at: this.deps.clock.now(),
      details,
    });
  }
}

/** The incident fields whose value differs between two versions (the audit's `fields`). */
function changedFields(before: IncidentRecord, after: IncidentRecord): string[] {
  const fields: string[] = [];
  if (before.kind !== after.kind) fields.push('kind');
  if (before.description !== after.description) fields.push('description');
  if ((before.resolvedAt === null) !== (after.resolvedAt === null)) fields.push('resolved');
  if (before.resolutionNote !== after.resolutionNote) fields.push('resolutionNote');
  return fields;
}
