import { Status } from '../../shared/ui/Status';
import type { ConnectionStatus } from '../live/live-state';

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
