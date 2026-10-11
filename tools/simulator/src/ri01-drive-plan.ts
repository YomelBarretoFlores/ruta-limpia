/**
 * The drive of the collection truck along RI-01, as a list of GPS fixes. It reuses the API's route
 * fixture and its route geometry (`apps/api/src/routes/domain`), so the simulator, the seed data
 * and the tests all drive the same street.
 *
 * Profile: the truck drives at a steady speed between reference points and stops at each one for
 * a dwell time (the crew picks the bags up), from about 30 m before P01 to about 30 m after P15.
 */
import { locateReferencePoints } from '../../../apps/api/src/routes/domain/reference-points.js';
import {
  RI01_REFERENCE_POINTS,
  RI01_ROUTE,
} from '../../../apps/api/src/routes/domain/ri01.fixture.js';
import {
  buildRouteGeometry,
  positionAtChainage,
} from '../../../apps/api/src/routes/domain/route-geometry.js';

/** Knots in one metre per second: OsmAnd and Traccar carry the speed in knots. */
export const KNOTS_PER_MPS = 3600 / 1852;

const GEOMETRY = buildRouteGeometry(RI01_ROUTE.polyline);

export const RI01_LENGTH_METERS = GEOMETRY.lengthMeters;

/** Where the truck stops: the 15 reference points, in route order. */
export const RI01_STOPS: readonly { readonly code: string; readonly chainage: number }[] =
  locateReferencePoints(GEOMETRY, RI01_REFERENCE_POINTS).map((point) => ({
    code: point.code,
    chainage: point.chainage,
  }));

export interface DrivePlanOptions {
  /** The time of the first fix (the truck at the route start). */
  readonly startAt: Date;
  /** Seconds between fixes; the pilot trackers report every 15 to 30 s. Default 20. */
  readonly intervalSec?: number;
  /** Speed between points, m/s. Default 3.5 (about 13 km/h). */
  readonly cruiseSpeedMps?: number;
  /** Seconds stopped at each reference point. Default 40. */
  readonly dwellSec?: number;
  /** Radius of the random GPS error, metres. Default 0 (exact positions). */
  readonly noiseMeters?: number;
  /** Seed of the noise, so a run can be repeated. Default 1. */
  readonly seed?: number;
  /**
   * No fix is sent from `atSec` for `durationSec` (a signal gap: over 60 s turns the ETA stale).
   * The fix at the route end is always sent, so the trip completes.
   */
  readonly gap?: { readonly atSec: number; readonly durationSec: number } | null;
}

export interface PlannedFix {
  /** Seconds since the start of the drive. */
  readonly offsetSec: number;
  readonly at: Date;
  readonly lat: number;
  readonly lon: number;
  readonly speedKnots: number;
  /** Degrees clockwise from north. */
  readonly bearing: number;
  /** Metres. */
  readonly accuracy: number;
  /** True distance along the route, metres (before any noise). */
  readonly chainage: number;
}

export interface DrivePlan {
  readonly fixes: readonly PlannedFix[];
  /** Seconds from the first fix to the arrival at the route end. */
  readonly durationSec: number;
  /** Fixes left out by the signal gap. */
  readonly skipped: number;
}

type Phase =
  | { readonly kind: 'move'; readonly start: number; readonly end: number; readonly from: number }
  | { readonly kind: 'stop'; readonly start: number; readonly end: number; readonly at: number };

/** The drive as consecutive moving and stopped phases, in seconds since the start. */
function phasesOf(cruise: number, dwell: number): Phase[] {
  const phases: Phase[] = [];
  let time = 0;
  let chainage = 0;
  for (const stop of RI01_STOPS) {
    const moving = (stop.chainage - chainage) / cruise;
    phases.push({ kind: 'move', start: time, end: time + moving, from: chainage });
    time += moving;
    phases.push({ kind: 'stop', start: time, end: time + dwell, at: stop.chainage });
    time += dwell;
    chainage = stop.chainage;
  }
  const last = (RI01_LENGTH_METERS - chainage) / cruise;
  phases.push({ kind: 'move', start: time, end: time + last, from: chainage });
  return phases;
}

/** Where the truck is `t` seconds into the drive, and whether it is moving. */
function stateAt(phases: readonly Phase[], cruise: number, t: number) {
  const phase = phases.find((p) => t < p.end);
  if (phase === undefined) return { chainage: RI01_LENGTH_METERS, moving: false };
  if (phase.kind === 'stop') return { chainage: phase.at, moving: false };
  return { chainage: phase.from + (t - phase.start) * cruise, moving: true };
}

/** Initial bearing, degrees clockwise from north, along the route at `chainage`. */
function bearingAt(chainage: number): number {
  const ahead = Math.min(chainage + 5, RI01_LENGTH_METERS);
  const from = positionAtChainage(GEOMETRY, ahead - 5);
  const to = positionAtChainage(GEOMETRY, ahead);
  const rad = Math.PI / 180;
  const y = Math.sin((to.lon - from.lon) * rad) * Math.cos(to.lat * rad);
  const x =
    Math.cos(from.lat * rad) * Math.sin(to.lat * rad) -
    Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lon - from.lon) * rad);
  return (((Math.atan2(y, x) / rad) % 360) + 360) % 360;
}

/** A small seeded random number generator (mulberry32): the same seed gives the same noise. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const METERS_PER_DEGREE = 111_320;
const BASE_ACCURACY_METERS = 5;

/** Plans the fixes of one drive of RI-01. */
export function planRi01Drive(options: DrivePlanOptions): DrivePlan {
  const interval = options.intervalSec ?? 20;
  const cruise = options.cruiseSpeedMps ?? 3.5;
  const dwell = options.dwellSec ?? 40;
  const noise = options.noiseMeters ?? 0;
  if (!(interval >= 15 && interval <= 30)) {
    throw new RangeError('The report interval must be between 15 and 30 seconds.');
  }
  if (!(cruise > 0) || !(dwell >= 0) || !(noise >= 0)) {
    throw new RangeError('The speed must be positive, and the dwell and the noise not negative.');
  }
  const gap = options.gap ?? null;
  const seconds = (value: number) => Number.isFinite(value) && value >= 0;
  if (gap !== null && !(seconds(gap.atSec) && seconds(gap.durationSec))) {
    throw new RangeError('The signal gap start and length must be finite, non-negative seconds.');
  }
  const phases = phasesOf(cruise, dwell);
  const durationSec = Math.ceil(phases.at(-1)!.end);
  const random = seededRandom(options.seed ?? 1);

  const offsets: number[] = [];
  for (let t = 0; t < durationSec; t += interval) offsets.push(t);
  offsets.push(durationSec);

  const fixes: PlannedFix[] = [];
  let skipped = 0;
  for (const offsetSec of offsets) {
    const { chainage, moving } = stateAt(phases, cruise, offsetSec);
    const exact = positionAtChainage(GEOMETRY, chainage);
    const angle = 2 * Math.PI * random();
    const distance = noise * Math.sqrt(random());
    // The fix at the route end is always sent: without it the trip could never complete.
    const inGap = gap !== null && offsetSec >= gap.atSec && offsetSec < gap.atSec + gap.durationSec;
    if (inGap && offsetSec < durationSec) {
      skipped += 1;
      continue;
    }
    const north = (distance * Math.cos(angle)) / METERS_PER_DEGREE;
    const east =
      (distance * Math.sin(angle)) / (METERS_PER_DEGREE * Math.cos((exact.lat * Math.PI) / 180));
    fixes.push({
      offsetSec,
      at: new Date(options.startAt.getTime() + offsetSec * 1000),
      lat: exact.lat + north,
      lon: exact.lon + east,
      speedKnots: moving ? cruise * KNOTS_PER_MPS : 0,
      bearing: bearingAt(chainage),
      accuracy: Math.round(BASE_ACCURACY_METERS + noise),
      chainage,
    });
  }
  return { fixes, durationSec, skipped };
}
