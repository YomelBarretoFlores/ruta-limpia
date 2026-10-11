/**
 * Instrument 2: the point observation sheet, filled in by the field team per point and visit. It
 * records what was observed, never inferred: the API only checks consistency and derives the
 * exposure of the first bag from the two observed times.
 */
export const OBSERVATION_PHASES = ['baseline', 'intervention', 'post'] as const;
export type ObservationPhase = (typeof OBSERVATION_PHASES)[number];

/** Scattered waste within 5 m of the point: "No", "Pocos", "Muchos". */
export const DISPERSION_LEVELS = ['none', 'few', 'many'] as const;
export type DispersionLevel = (typeof DISPERSION_LEVELS)[number];

/** Observed cause of the dispersion. */
export const DISPERSION_CAUSES = [
  'animals',
  'wind',
  'manipulation',
  'undetermined',
  'other',
] as const;
export type DispersionCause = (typeof DISPERSION_CAUSES)[number];

/** A photo is never stored: only whether it was taken and its code in the team's archive. */
export interface PhotoRecord {
  readonly taken: boolean;
  readonly code: string | null;
}

/** The musical-notice observation (points P04, P08, P12): a fixed window and the music heard. */
export interface MusicObservation {
  /** `HH:MM`, local time. */
  readonly windowStart: string;
  readonly windowEnd: string;
  /** Cumulative seconds of music heard inside the window. */
  readonly musicSeconds: number;
  /** Weather and other noise sources. */
  readonly conditions: string | null;
}

export interface PointObservationFacts {
  /** `HH:MM` local time the first bag was put out; null when not observed. */
  readonly firstPlacementTime: string | null;
  /** `HH:MM` local time the truck passed; null when not observed. */
  readonly truckPassTime: string | null;
  /** Observed exposure (minutes), used only when one of the two times is missing. */
  readonly exposureMinutes: number | null;
  readonly bagsAtPass: number | null;
  readonly brokenBags: number | null;
  readonly dispersion: DispersionLevel | null;
  readonly dispersionCauses: readonly DispersionCause[];
  readonly dispersionCauseOther: string | null;
  readonly wasteRemainingAfterPass: boolean | null;
  readonly photoBefore: PhotoRecord;
  readonly photoAfter: PhotoRecord;
  readonly music: MusicObservation | null;
}

export type ObservationProblem =
  | 'pass_before_placement'
  | 'broken_bags_exceed_bags'
  | 'causes_without_dispersion'
  /** The "other" cause is ticked but its text is missing. */
  | 'other_cause_text_required'
  /** A text for the "other" cause is given but "other" is not ticked. */
  | 'other_cause_text_without_other'
  | 'photo_code_without_photo'
  | 'music_not_observed_at_point'
  | 'music_window_invalid'
  | 'music_seconds_exceed_window';

/** Minutes since midnight of an `HH:MM` time. */
export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/**
 * The exposure of the first bag: from its placement to the truck's pass, in minutes, when both
 * were observed; otherwise the observed value given (or null).
 */
export function resolveExposureMinutes(facts: PointObservationFacts): {
  readonly minutes: number | null;
  readonly computed: boolean;
} {
  if (facts.firstPlacementTime !== null && facts.truckPassTime !== null) {
    return {
      minutes: minutesOfDay(facts.truckPassTime) - minutesOfDay(facts.firstPlacementTime),
      computed: true,
    };
  }
  return { minutes: facts.exposureMinutes, computed: false };
}

/** Every inconsistency of a sheet (empty when it can be stored). */
export function observationProblems(
  facts: PointObservationFacts,
  point: { readonly observesMusic: boolean },
): ObservationProblem[] {
  const problems: ObservationProblem[] = [];
  const exposure = resolveExposureMinutes(facts);
  if (exposure.computed && (exposure.minutes ?? 0) < 0) problems.push('pass_before_placement');
  if (
    facts.bagsAtPass !== null &&
    facts.brokenBags !== null &&
    facts.brokenBags > facts.bagsAtPass
  ) {
    problems.push('broken_bags_exceed_bags');
  }
  if (
    facts.dispersionCauses.length > 0 &&
    (facts.dispersion === null || facts.dispersion === 'none')
  ) {
    problems.push('causes_without_dispersion');
  }
  const hasOtherText = (facts.dispersionCauseOther?.trim() ?? '') !== '';
  const hasOtherCause = facts.dispersionCauses.includes('other');
  if (hasOtherCause && !hasOtherText) problems.push('other_cause_text_required');
  if (hasOtherText && !hasOtherCause) problems.push('other_cause_text_without_other');
  for (const photo of [facts.photoBefore, facts.photoAfter]) {
    if (!photo.taken && photo.code !== null) problems.push('photo_code_without_photo');
  }
  if (facts.music !== null) {
    if (!point.observesMusic) {
      problems.push('music_not_observed_at_point');
    } else {
      const windowSeconds =
        (minutesOfDay(facts.music.windowEnd) - minutesOfDay(facts.music.windowStart)) * 60;
      if (windowSeconds <= 0) problems.push('music_window_invalid');
      else if (facts.music.musicSeconds > windowSeconds) {
        problems.push('music_seconds_exceed_window');
      }
    }
  }
  return [...new Set(problems)];
}
