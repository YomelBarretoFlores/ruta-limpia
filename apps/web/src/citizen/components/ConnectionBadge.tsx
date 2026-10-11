import { Status, type StatusTone } from '../../shared/ui/Status';
import type { ConnectionStatus } from '../live/live-state';

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Conectando…',
  live: 'En vivo',
  reconnecting: 'Reconectando…',
  polling: 'Se actualiza cada 30 s',
};

const TONES: Record<ConnectionStatus, StatusTone> = {
  connecting: 'none',
  live: 'live',
  reconnecting: 'stale',
  polling: 'stale',
};

/** Whether the page receives live updates, in words with a small swatch. */
export function ConnectionBadge({ status }: { readonly status: ConnectionStatus }) {
  return <Status tone={TONES[status]} label={LABELS[status]} announce />;
}
