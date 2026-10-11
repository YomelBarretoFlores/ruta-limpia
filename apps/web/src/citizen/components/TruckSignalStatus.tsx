import { Status, type StatusTone } from '../../shared/ui/Status';
import type { TruckSignal } from '../live/live-state';

const SIGNAL_LABELS: Record<TruckSignal, string> = {
  loading: 'Conectando…',
  no_trip: 'Sin recorrido',
  live: 'En vivo',
  stale: 'Sin actualización',
  none: 'Esperando señal',
};

const SIGNAL_TONES: Record<TruckSignal, StatusTone> = {
  loading: 'none',
  no_trip: 'none',
  live: 'live',
  stale: 'stale',
  none: 'none',
};

/** The truck's signal in words with a small swatch: the status of the arrival section. */
export function TruckSignalStatus({ signal }: { readonly signal: TruckSignal }) {
  return <Status tone={SIGNAL_TONES[signal]} label={SIGNAL_LABELS[signal]} announce />;
}
