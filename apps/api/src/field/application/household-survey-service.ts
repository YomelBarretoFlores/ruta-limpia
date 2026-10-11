import type { PanelActor } from '../../auth/application/panel-actor.js';
import type { AuditLog } from '../../shared/application/audit-log.js';
import type { Clock } from '../../shared/application/clock.js';
import type { UnitOfWork } from '../../shared/application/unit-of-work.js';
import {
  surveyProblems,
  type SurveyAnswers,
  type SurveyProblem,
  type SurveyWave,
} from '../domain/household-survey.js';

/** A survey as the panel sends it: the household by its code. */
export interface SurveyCommand extends SurveyAnswers {
  readonly householdCode: string;
  readonly wave: SurveyWave;
  /** `YYYY-MM-DD`, local date. */
  readonly surveyedOn: string;
}

export interface StoredSurvey extends SurveyAnswers {
  readonly householdId: string;
  readonly wave: SurveyWave;
  readonly surveyedOn: string;
}

export interface SurveyRecord extends StoredSurvey {
  readonly id: string;
  readonly householdCode: string;
  readonly routeCode: string;
  /** The CSV import that last wrote the survey; null when typed in the panel. */
  readonly importBatchId: string | null;
  readonly createdByUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SurveyFilter {
  readonly routeCode?: string;
  readonly wave?: SurveyWave;
  readonly householdCode?: string;
}

/** Port: Instrument 3 surveys. */
export interface HouseholdSurveyStore {
  /** Null when the household already has a survey of that wave. */
  insert(
    survey: StoredSurvey,
    meta: { readonly createdByUserId: string; readonly at: Date },
  ): Promise<SurveyRecord | null>;
  findById(id: string): Promise<SurveyRecord | null>;
  /** `not_found` when deleted meanwhile; `duplicate` when another survey has that wave. */
  update(
    id: string,
    survey: StoredSurvey,
    at: Date,
  ): Promise<SurveyRecord | 'not_found' | 'duplicate'>;
  delete(id: string): Promise<boolean>;
  list(
    filter: SurveyFilter,
    window: { readonly limit: number; readonly offset: number },
  ): Promise<{ readonly items: SurveyRecord[]; readonly total: number }>;
  /** The households with these codes (any route, active or not). */
  householdsByCode(codes: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/** The ports a survey change writes through, in one transaction with its audit event. */
export interface SurveyTransaction {
  readonly store: HouseholdSurveyStore;
  readonly audit: AuditLog;
}

export type SurveyResult =
  | { readonly status: 'ok'; readonly survey: SurveyRecord }
  | { readonly status: 'unknown_household' | 'duplicate_survey' | 'not_found' }
  | { readonly status: 'invalid_survey'; readonly problems: SurveyProblem[] };

export interface HouseholdSurveyDependencies {
  /** Reads outside any transaction. */
  readonly store: HouseholdSurveyStore;
  readonly transactions: UnitOfWork<SurveyTransaction>;
  readonly clock: Clock;
}

/**
 * Instrument 3: surveys typed in the panel. Every change commits with its audit event.
 */
export class HouseholdSurveyService {
  constructor(private readonly deps: HouseholdSurveyDependencies) {}

  list(filter: SurveyFilter, window: { limit: number; offset: number }) {
    return this.deps.store.list(filter, window);
  }

  get(id: string): Promise<SurveyRecord | null> {
    return this.deps.store.findById(id);
  }

  async create(command: SurveyCommand, actor: PanelActor): Promise<SurveyResult> {
    const prepared = await this.prepare(command);
    if (prepared.status !== 'ok') return prepared;
    const now = this.deps.clock.now();
    return this.deps.transactions.run(async ({ store, audit }) => {
      const survey = await store.insert(prepared.stored, {
        createdByUserId: actor.userId,
        at: now,
      });
      if (survey === null) return { status: 'duplicate_survey' };
      await this.record(audit, 'household_survey.created', actor, survey);
      return { status: 'ok', survey };
    });
  }

  /** Replaces the survey's content (the client sends the whole edited survey). */
  async update(id: string, command: SurveyCommand, actor: PanelActor): Promise<SurveyResult> {
    const prepared = await this.prepare(command);
    if (prepared.status !== 'ok') return prepared;
    return this.deps.transactions.run(async ({ store, audit }) => {
      const survey = await store.update(id, prepared.stored, this.deps.clock.now());
      if (survey === 'not_found') return { status: 'not_found' };
      if (survey === 'duplicate') return { status: 'duplicate_survey' };
      await this.record(audit, 'household_survey.updated', actor, survey);
      return { status: 'ok', survey };
    });
  }

  async delete(id: string, actor: PanelActor): Promise<SurveyResult> {
    const current = await this.deps.store.findById(id);
    if (current === null) return { status: 'not_found' };
    return this.deps.transactions.run(async ({ store, audit }) => {
      if (!(await store.delete(id))) return { status: 'not_found' };
      await this.record(audit, 'household_survey.deleted', actor, current);
      return { status: 'ok', survey: current };
    });
  }

  private async prepare(
    command: SurveyCommand,
  ): Promise<
    | { readonly status: 'ok'; readonly stored: StoredSurvey }
    | Exclude<SurveyResult, { status: 'ok' }>
  > {
    const problems = surveyProblems(command.wave, command);
    if (problems.length > 0) return { status: 'invalid_survey', problems };
    const households = await this.deps.store.householdsByCode([command.householdCode]);
    const householdId = households.get(command.householdCode);
    if (householdId === undefined) return { status: 'unknown_household' };
    return { status: 'ok', stored: toStored(command, householdId) };
  }

  private async record(
    audit: AuditLog,
    action: string,
    actor: PanelActor,
    survey: SurveyRecord,
  ): Promise<void> {
    await audit.record({
      userId: actor.userId,
      action,
      entity: 'household_survey',
      entityId: survey.id,
      at: this.deps.clock.now(),
      details: { householdCode: survey.householdCode, wave: survey.wave },
    });
  }
}

/** The command with its household resolved (the code itself is not stored with the survey). */
function toStored(command: SurveyCommand, householdId: string): StoredSurvey {
  const answers: Omit<SurveyCommand, 'householdCode'> & { householdCode?: string } = {
    ...command,
  };
  delete answers.householdCode;
  return { ...answers, householdId };
}
