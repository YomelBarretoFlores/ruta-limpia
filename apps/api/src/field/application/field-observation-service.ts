import type { PanelActor } from '../../auth/application/panel-actor.js';
import { can } from '../../auth/domain/role.js';
import type { RoutePointResolver } from '../../routes/application/route-point-resolver.js';
import type { AuditLog } from '../../shared/application/audit-log.js';
import type { Clock } from '../../shared/application/clock.js';
import {
  canReadFieldRecord,
  fieldEditVerdict,
  type FieldRecordOwnership,
} from '../domain/field-record-access.js';
import {
  observationProblems,
  resolveExposureMinutes,
  type ObservationPhase,
  type ObservationProblem,
  type PointObservationFacts,
} from '../domain/point-observation.js';

/** Where and when a sheet was filled in. */
export interface ObservationVisit {
  /** `YYYY-MM-DD`, local date. */
  readonly observedOn: string;
  readonly phase: ObservationPhase;
  /** Names or initials of the observers, as written on the paper sheet. */
  readonly observers: string;
  readonly notes: string | null;
}

export interface FieldObservationRecord
  extends ObservationVisit, PointObservationFacts, FieldRecordOwnership {
  readonly id: string;
  readonly routeId: string;
  readonly routeCode: string;
  readonly pointCode: string;
  readonly tripId: string | null;
  /** True when the exposure was derived from the two observed times. */
  readonly exposureComputed: boolean;
  readonly updatedAt: Date;
}

export interface StoredObservation extends ObservationVisit, PointObservationFacts {
  readonly routeId: string;
  readonly pointId: string;
  readonly tripId: string | null;
  readonly exposureComputed: boolean;
}

export interface FieldObservationFilter {
  readonly routeCode?: string;
  readonly pointCode?: string;
  readonly phase?: ObservationPhase;
  readonly from?: string;
  readonly to?: string;
  /** Only the sheets this user created. */
  readonly createdByUserId?: string;
}

/** Port: Instrument 2 sheets. */
export interface FieldObservationStore {
  insert(
    observation: StoredObservation,
    meta: { readonly createdByUserId: string; readonly at: Date },
  ): Promise<FieldObservationRecord>;
  findById(id: string): Promise<FieldObservationRecord | null>;
  update(id: string, observation: StoredObservation, at: Date): Promise<FieldObservationRecord>;
  delete(id: string): Promise<void>;
  list(
    filter: FieldObservationFilter,
    window: { readonly limit: number; readonly offset: number },
  ): Promise<{ readonly items: FieldObservationRecord[]; readonly total: number }>;
  routeOfTrip(tripId: string): Promise<string | null>;
}

export interface ObservationCommand extends ObservationVisit, PointObservationFacts {
  readonly routeCode: string;
  readonly pointCode: string;
  readonly tripId: string | null;
}

export type ObservationFailure =
  | { readonly status: 'unknown_route' | 'unknown_point' | 'unknown_trip' | 'trip_route_mismatch' }
  | { readonly status: 'invalid_observation'; readonly problems: ObservationProblem[] }
  | { readonly status: 'not_found' | 'not_owner' | 'edit_window_closed' };

export type ObservationResult =
  { readonly status: 'ok'; readonly observation: FieldObservationRecord } | ObservationFailure;

export interface FieldObservationDependencies {
  readonly store: FieldObservationStore;
  readonly points: RoutePointResolver;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

/**
 * Instrument 2 sheets: create, read, edit and delete with the field ownership rules (observers
 * see their own sheets and may change them for 24 hours; supervisors and administrators, all).
 */
export class FieldObservationService {
  constructor(private readonly deps: FieldObservationDependencies) {}

  list(
    filter: FieldObservationFilter,
    window: { limit: number; offset: number },
    actor: PanelActor,
  ) {
    const scoped = can(actor.role, 'field:read_all')
      ? filter
      : { ...filter, createdByUserId: actor.userId };
    return this.deps.store.list(scoped, window);
  }

  async get(id: string, actor: PanelActor): Promise<FieldObservationRecord | null> {
    const record = await this.deps.store.findById(id);
    return record !== null && canReadFieldRecord(actor.role, actor.userId, record) ? record : null;
  }

  async create(command: ObservationCommand, actor: PanelActor): Promise<ObservationResult> {
    const prepared = await this.prepare(command);
    if (prepared.status !== 'ok') return prepared;
    const now = this.deps.clock.now();
    const observation = await this.deps.store.insert(prepared.stored, {
      createdByUserId: actor.userId,
      at: now,
    });
    await this.record('field_observation.created', actor, observation);
    return { status: 'ok', observation };
  }

  /** Replaces the sheet's content (the client sends the whole edited sheet). */
  async update(
    id: string,
    command: ObservationCommand,
    actor: PanelActor,
  ): Promise<ObservationResult> {
    const access = await this.editable(id, actor);
    if (access.status !== 'ok') return access;
    const prepared = await this.prepare(command);
    if (prepared.status !== 'ok') return prepared;
    const observation = await this.deps.store.update(id, prepared.stored, this.deps.clock.now());
    await this.record('field_observation.updated', actor, observation);
    return { status: 'ok', observation };
  }

  async delete(id: string, actor: PanelActor): Promise<ObservationResult> {
    const access = await this.editable(id, actor);
    if (access.status !== 'ok') return access;
    await this.deps.store.delete(id);
    await this.record('field_observation.deleted', actor, access.observation);
    return access;
  }

  private async editable(id: string, actor: PanelActor): Promise<ObservationResult> {
    const current = await this.get(id, actor);
    if (current === null) return { status: 'not_found' };
    const verdict = fieldEditVerdict(actor.role, actor.userId, current, this.deps.clock.now());
    return verdict === 'allowed' ? { status: 'ok', observation: current } : { status: verdict };
  }

  private async prepare(
    command: ObservationCommand,
  ): Promise<{ readonly status: 'ok'; readonly stored: StoredObservation } | ObservationFailure> {
    const resolved = await this.deps.points.resolve(command.routeCode, command.pointCode);
    if (resolved.status !== 'ok' || resolved.point === null) {
      return { status: resolved.status === 'ok' ? 'unknown_point' : resolved.status };
    }
    if (command.tripId !== null) {
      const tripRoute = await this.deps.store.routeOfTrip(command.tripId);
      if (tripRoute === null) return { status: 'unknown_trip' };
      if (tripRoute !== resolved.routeId) return { status: 'trip_route_mismatch' };
    }
    const problems = observationProblems(command, resolved.point);
    if (problems.length > 0) return { status: 'invalid_observation', problems };
    const exposure = resolveExposureMinutes(command);
    return {
      status: 'ok',
      stored: {
        observedOn: command.observedOn,
        phase: command.phase,
        observers: command.observers,
        notes: command.notes,
        tripId: command.tripId,
        firstPlacementTime: command.firstPlacementTime,
        truckPassTime: command.truckPassTime,
        bagsAtPass: command.bagsAtPass,
        brokenBags: command.brokenBags,
        dispersion: command.dispersion,
        dispersionCauses: command.dispersionCauses,
        dispersionCauseOther: command.dispersionCauseOther,
        wasteRemainingAfterPass: command.wasteRemainingAfterPass,
        photoBefore: command.photoBefore,
        photoAfter: command.photoAfter,
        music: command.music,
        routeId: resolved.routeId,
        pointId: resolved.point.id,
        exposureMinutes: exposure.minutes,
        exposureComputed: exposure.computed,
      },
    };
  }

  private async record(
    action: string,
    actor: PanelActor,
    observation: FieldObservationRecord,
  ): Promise<void> {
    await this.deps.audit.record({
      userId: actor.userId,
      action,
      entity: 'field_observation',
      entityId: observation.id,
      at: this.deps.clock.now(),
      details: {
        routeCode: observation.routeCode,
        pointCode: observation.pointCode,
        observedOn: observation.observedOn,
        phase: observation.phase,
      },
    });
  }
}
