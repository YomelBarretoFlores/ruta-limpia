import { Button } from '../../shared/ui/Button';
import { Notice } from '../../shared/ui/Notice';
import { errorMessage } from './errors';

/** What a list shows before its first data: "Cargando…" or the failure with a retry. */
export function LoadState({
  status,
  error,
  onRetry,
  what,
}: {
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: unknown;
  readonly onRetry: () => void;
  /** What is loading, for example "los viajes". */
  readonly what: string;
}) {
  if (status === 'error') {
    return (
      <div>
        <Notice tone="danger" title={`No se pudieron cargar ${what}`}>
          <p>{errorMessage(error)}</p>
        </Notice>
        <Button variant="secondary" className="button--compact" onClick={onRetry}>
          Intentar de nuevo
        </Button>
      </div>
    );
  }
  return <p className="panel-loading">Cargando {what}…</p>;
}
