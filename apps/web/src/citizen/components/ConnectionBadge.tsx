import type { ConnectionStatus } from '../live/live-state';

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Conectando…',
  live: 'En vivo',
  reconnecting: 'Reconectando…',
  polling: 'Se actualiza cada 30 s',
};

/** Whether the page receives live updates. */
export function ConnectionBadge({ status }: { readonly status: ConnectionStatus }) {
  return (
    <span className={`badge badge--${status}`} role="status">
      <span className="badge__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
