import { Status, type StatusTone } from '../../shared/ui/Status';
import type { ConnectionStatus, TruckSignal } from '../live/live-state';

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

/** The degraded connection states; a working connection is not worth a second status. */
const DEGRADED_LABELS: Partial<Record<ConnectionStatus, string>> = {
  reconnecting: 'Reconectando…',
  polling: 'Se actualiza cada 30 s',
};

/**
 * Whether the page still receives live updates, shown only when it does not (reconnecting or
 * polling). It is separate from the truck's signal: a live page can report a silent truck.
 */
export function ConnectionBadge({ status }: { readonly status: ConnectionStatus }) {
  const label = DEGRADED_LABELS[status];
  return label === undefined ? null : <Status tone="stale" label={label} announce />;
}
