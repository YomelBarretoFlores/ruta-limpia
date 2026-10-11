/** The ETA as citizens see it: a range of whole minutes, for example "8 a 12 minutos". */
export interface EtaDisplayWindow {
  readonly minMinutes: number;
  readonly maxMinutes: number;
}

export interface EtaDisplaySettings {
  /** The uncertainty is at least this many seconds on each side, even when the truck is close. */
  readonly minUncertaintySec: number;
  /** ...and grows with the remaining time: this fraction of it on each side. */
  readonly relativeUncertainty: number;
}

export const DEFAULT_ETA_DISPLAY_SETTINGS: EtaDisplaySettings = Object.freeze({
  minUncertaintySec: 60,
  relativeUncertainty: 0.2,
});

/**
 * Turns a live prediction into a window of whole minutes. The uncertainty is
 * ±max(1 min, 20 %) of the remaining time, so a far truck shows a wider range: 600 s gives
 * 8–12 min, 120 s gives 1–3 min. The lower bound rounds down and never goes below 0; the upper
 * bound rounds up and is always above the lower one.
 *
 * Only `live` predictions have a window; stale telemetry never gets one.
 */
export function etaDisplayWindow(
  secondsRemaining: number,
  settings: EtaDisplaySettings = DEFAULT_ETA_DISPLAY_SETTINGS,
): EtaDisplayWindow {
  const seconds = Math.max(0, secondsRemaining);
  const uncertainty = Math.max(settings.minUncertaintySec, seconds * settings.relativeUncertainty);
  const minMinutes = Math.max(0, Math.floor((seconds - uncertainty) / 60));
  const maxMinutes = Math.max(minMinutes + 1, Math.ceil((seconds + uncertainty) / 60));
  return { minMinutes, maxMinutes };
}
