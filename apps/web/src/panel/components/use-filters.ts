import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/**
 * List filters kept in the address (`?estado=active&pagina=2`), so the back button and a shared
 * link restore the same view. Changing a filter goes back to the first page.
 */
export function useFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  // Plain strings: callers list them as dependencies of their loaders.
  const values = Object.fromEntries(keys.map((key) => [key, params.get(key) ?? ''])) as Record<
    K,
    string
  >;
  const page = Math.max(1, Number.parseInt(params.get('pagina') ?? '1', 10) || 1);

  /** Sets several filters in one address change (two separate changes would lose the first). */
  const setFilters = useCallback(
    (changes: Partial<Record<K, string>>) =>
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          for (const [key, value] of Object.entries(changes) as [K, string | undefined][]) {
            if (value === undefined || value === '') next.delete(key);
            else next.set(key, value);
          }
          next.delete('pagina');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const setFilter = useCallback(
    (key: K, value: string) => setFilters({ [key]: value } as Partial<Record<K, string>>),
    [setFilters],
  );
  const setPage = useCallback(
    (value: number) =>
      setParams((previous) => {
        const next = new URLSearchParams(previous);
        if (value <= 1) next.delete('pagina');
        else next.set('pagina', String(value));
        return next;
      }),
    [setParams],
  );
  return { values, page, setFilter, setFilters, setPage };
}
