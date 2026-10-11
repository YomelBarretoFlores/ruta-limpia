import { DEFAULT_ALERT_SETTINGS, type AlertSettings } from '../../alerts/domain/alert-policy.js';
import { DEFAULT_ETA_SETTINGS, type EtaSettings } from '../../eta/domain/eta-settings.js';
import { DEFAULT_TRACKING_SETTINGS, type TrackingSettings } from '../domain/tracking-settings.js';

export interface TrackingPipelineSettings {
  readonly tracking: TrackingSettings;
  readonly eta: EtaSettings;
  readonly alerts: AlertSettings;
  /** A trip auto-starts only when a fix projects within this distance of the route start. */
  readonly startZoneMeters: number;
  /**
   * A fix dated more than this ahead of the server clock is ignored: it would keep the trip
   * `live` and delay the inactivity abort (a tracker with a wrong clock or time zone).
   */
  readonly maxFixFutureSkewSec: number;
}

export const DEFAULT_TRACKING_PIPELINE_SETTINGS: TrackingPipelineSettings = Object.freeze({
  tracking: DEFAULT_TRACKING_SETTINGS,
  eta: DEFAULT_ETA_SETTINGS,
  alerts: DEFAULT_ALERT_SETTINGS,
  startZoneMeters: 150,
  maxFixFutureSkewSec: 120,
});
