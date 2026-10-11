import { useCallback, useEffect, useState } from 'react';

export interface AsyncResult<T> {
  /** `loading` until the current request settles (also while reloading). */
  readonly status: 'loading' | 'ready' | 'error';
  /** The latest data loaded, kept while a reload runs (the table does not blink). */
  readonly data: T | undefined;
  readonly error: unknown;
  /** Loads again (after a change, or periodically). */
  readonly reload: () => void;
}

type Settled<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: unknown };

/**
 * Runs `load` and keeps its outcome. `load` must be stable (`useCallback`): a new function means
 * new inputs, and the data is loaded again. An answer that arrives after newer inputs is ignored.
 */
export function useAsync<T>(load: () => Promise<T>): AsyncResult<T> {
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<{
    readonly load: () => Promise<T>;
    readonly version: number;
    readonly outcome: Settled<T>;
  } | null>(null);
  const [latest, setLatest] = useState<T | undefined>(undefined);

  useEffect(() => {
    let current = true;
    load().then(
      (data) => {
        if (!current) return;
        setLatest(data);
        setSettled({ load, version, outcome: { ok: true, data } });
      },
      (error: unknown) => {
        if (current) setSettled({ load, version, outcome: { ok: false, error } });
      },
    );
    return () => {
      current = false;
    };
  }, [load, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const fresh = settled !== null && settled.load === load && settled.version === version;
  if (!fresh) return { status: 'loading', data: latest, error: undefined, reload };
  return settled.outcome.ok
    ? { status: 'ready', data: settled.outcome.data, error: undefined, reload }
    : { status: 'error', data: latest, error: settled.outcome.error, reload };
}
