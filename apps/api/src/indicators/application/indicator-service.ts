import type { Clock } from '../../shared/application/clock.js';
import { summarizeAdoption, type HouseholdWeek } from '../domain/adoption.js';
import {
  computeIndicators,
  type AdoptionWeek,
  type EtaErrorRow,
  type IndicatorResult,
  type ObservationRow,
  type SurveyRow,
} from '../domain/impact-indicators.js';

/**
 * The period and route the indicators are computed for. Phases such as Fase 3 are not stored:
 * `from` and `to` (local dates, inclusive) select the logs of the system (I1, I5, I6's active
 * households, I7), while the field and survey indicators compare their stored phases and waves.
 */
export interface IndicatorQuery {
  readonly routeCode: string;
  /** `YYYY-MM-DD`, America/Lima. */
  readonly from: string;
  readonly to: string;
}

/** The recorded inputs of the indicators of one route. */
export interface IndicatorSources {
  readonly etaErrors: readonly EtaErrorRow[];
  readonly observations: readonly ObservationRow[];
  readonly surveys: readonly SurveyRow[];
  readonly householdWeeks: readonly HouseholdWeek[];
  readonly availability: { readonly intervals: number; readonly available: number };
}

/** Port: reads the indicator inputs. Null when there is no route with that code. */
export interface IndicatorReadModel {
  sources(query: IndicatorQuery, now: Date): Promise<IndicatorSources | null>;
}

export interface IndicatorReport extends IndicatorQuery {
  readonly generatedAt: Date;
  readonly indicators: readonly IndicatorResult[];
  readonly adoptionWeeks: readonly AdoptionWeek[];
  readonly householdWeeks: readonly HouseholdWeek[];
}

export type IndicatorReportResult =
  | { readonly status: 'ok'; readonly report: IndicatorReport }
  | { readonly status: 'unknown_route' };

export interface IndicatorServiceDependencies {
  readonly readModel: IndicatorReadModel;
  readonly clock: Clock;
}

/** Computes Tabla 16 for a route and a period, from the logs and the field instruments. */
export class IndicatorService {
  constructor(private readonly deps: IndicatorServiceDependencies) {}

  async report(query: IndicatorQuery): Promise<IndicatorReportResult> {
    const now = this.deps.clock.now();
    const sources = await this.deps.readModel.sources(query, now);
    if (sources === null) return { status: 'unknown_route' };
    const adoption = summarizeAdoption(sources.householdWeeks);
    const indicators = computeIndicators({
      etaErrors: sources.etaErrors,
      observations: sources.observations,
      surveys: sources.surveys,
      adoptionWeeks: adoption.weeks,
      activeHouseholdIds: adoption.activeHouseholdIds,
      availability: sources.availability,
    });
    return {
      status: 'ok',
      report: {
        ...query,
        generatedAt: now,
        indicators,
        adoptionWeeks: adoption.weeks,
        householdWeeks: sources.householdWeeks,
      },
    };
  }
}
