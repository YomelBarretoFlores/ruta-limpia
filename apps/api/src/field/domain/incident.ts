/** What can go wrong on a collection route (closed list, as on the field forms). */
export const INCIDENT_KINDS = [
  'truck_breakdown',
  'route_change',
  'gps_failure',
  'alert_failure',
  'missed_collection',
  'weather',
  'other',
] as const;

export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_DESCRIPTION_MAX_LENGTH = 1000;
