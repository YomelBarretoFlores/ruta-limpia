import type { StatusTone } from '../shared/ui/Status';
import type { AlertStatus, IncidentKind, ObservationPhase, TripStatus } from './api/types';

/** The alert state of a point in the live table, in words with its swatch tone. */
export const ALERT_STATUS: Record<
  AlertStatus,
  { readonly label: string; readonly tone: StatusTone }
> = {
  sent: { label: 'Enviado', tone: 'live' },
  preparing: { label: 'En preparación', tone: 'stale' },
  waiting: { label: 'En espera', tone: 'none' },
  not_sent: { label: 'No enviado', tone: 'lost' },
};

export const INCIDENT_KIND_LABELS: Record<IncidentKind, string> = {
  truck_breakdown: 'Avería del camión',
  route_change: 'Cambio de ruta',
  gps_failure: 'Falla del GPS',
  alert_failure: 'Falla de los avisos',
  missed_collection: 'Recolección omitida',
  weather: 'Clima',
  other: 'Otra',
};

export const TRIP_STATUS: Record<
  TripStatus,
  { readonly label: string; readonly tone: StatusTone }
> = {
  active: { label: 'En curso', tone: 'live' },
  completed: { label: 'Completado', tone: 'none' },
  aborted: { label: 'Finalizado a mano', tone: 'stale' },
};

export const PHASE_LABELS: Record<ObservationPhase, string> = {
  baseline: 'Línea base',
  intervention: 'Intervención',
  post: 'Posterior',
};

/** The truck's GPS signal (or no trip) as the summary shows it. */
export function signalStatus(signal: 'live' | 'stale' | 'none' | null): {
  readonly label: string;
  readonly tone: StatusTone;
} {
  switch (signal) {
    case 'live':
      return { label: 'En vivo', tone: 'live' };
    case 'stale':
      return { label: 'Sin actualización', tone: 'stale' };
    case 'none':
      return { label: 'Sin señal', tone: 'lost' };
    case null:
      return { label: 'Sin recorrido', tone: 'none' };
  }
}
