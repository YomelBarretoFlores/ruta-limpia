import type { PointEta } from '../../eta/domain/eta-estimator.js';

/** Tunables for the proximity-alert policy, in seconds before the predicted pass. */
export interface AlertSettings {
  /** Below this lead time an alert is pointless: the household cannot get the waste out in time. */
  readonly leadMinSec: number;
  /** Alert as soon as the predicted pass is this close. */
  readonly leadMaxSec: number;
  /** Target window from the proposal (5–10 min); alerts outside it are flagged for analysis. */
  readonly targetWindowMinSec: number;
  readonly targetWindowMaxSec: number;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = Object.freeze({
  leadMinSec: 60,
  leadMaxSec: 600,
  targetWindowMinSec: 300,
  targetWindowMaxSec: 600,
});

/** A proximity alert to emit, with the prediction exactly as communicated (logged, never rebuilt). */
export interface AlertDecision {
  readonly tripId: string;
  readonly pointId: string;
  readonly emittedAt: Date;
  readonly communicatedPredictedPassAt: Date;
  readonly secondsRemainingAtEmission: number;
  readonly insideTargetWindow: boolean;
}

export interface AlertPolicyInput {
  readonly tripId: string;
  readonly now: Date;
  readonly etas: readonly PointEta[];
  /** Points already alerted in this trip. */
  readonly alreadyAlertedPointIds: readonly string[];
}

/**
 * Decides which proximity alerts to emit now: one per (trip, point), only for a live ETA (fresh
 * telemetry, point not yet passed) whose remaining time is within [leadMin, leadMax].
 */
export function decideAlerts(
  input: AlertPolicyInput,
  settings: AlertSettings = DEFAULT_ALERT_SETTINGS,
): AlertDecision[] {
  const alerted = new Set(input.alreadyAlertedPointIds);
  const decisions: AlertDecision[] = [];
  for (const eta of input.etas) {
    if (eta.status !== 'live' || alerted.has(eta.pointId)) continue;
    const remaining = eta.secondsRemaining;
    if (remaining > settings.leadMaxSec || remaining < settings.leadMinSec) continue;
    decisions.push({
      tripId: input.tripId,
      pointId: eta.pointId,
      emittedAt: input.now,
      communicatedPredictedPassAt: eta.predictedPassAt,
      secondsRemainingAtEmission: remaining,
      insideTargetWindow:
        remaining >= settings.targetWindowMinSec && remaining <= settings.targetWindowMaxSec,
    });
  }
  return decisions;
}

/** ETA error indicator: |communicated predicted pass time − actual pass time|, in minutes. */
export function etaErrorMinutes(communicatedPredictedPassAt: Date, actualPassAt: Date): number {
  return Math.abs(actualPassAt.getTime() - communicatedPredictedPassAt.getTime()) / 60_000;
}
