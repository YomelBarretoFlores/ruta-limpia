/**
 * Runs `work` for every item with at most `limit` running at once, and resolves when all have
 * settled. `work` must handle its own errors; a rejection is rethrown only after every item ran.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++] as T;
      try {
        await work(item);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  if (failures.length > 0) throw new AggregateError(failures, 'Some items failed');
}
