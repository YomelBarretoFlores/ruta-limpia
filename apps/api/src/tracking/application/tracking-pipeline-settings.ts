import { DEFAULT_ALERT_SETTINGS, type AlertSettings } from '../../alerts/domain/alert-policy.js';
import { DEFAULT_ETA_SETTINGS, type EtaSettings } from '../../eta/domain/eta-settings.js';
import { DEFAULT_TRACKING_SETTINGS, type TrackingSettings } from '../domain/tracking-settings.js';

export interface TrackingPipelineSettings {
  readonly tracking: TrackingSettings;
  readonly eta: EtaSettings;
  readonly alerts: AlertSettings;
  /** A trip auto-starts only when a fix projects within this distance of the route start. */
  readonly startZoneMeters: number;
}

export const DEFAULT_TRACKING_PIPELINE_SETTINGS: TrackingPipelineSettings = Object.freeze({
  tracking: DEFAULT_TRACKING_SETTINGS,
  eta: DEFAULT_ETA_SETTINGS,
  alerts: DEFAULT_ALERT_SETTINGS,
  startZoneMeters: 150,
});
