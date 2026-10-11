import { useEffect, useState } from 'react';

/** The current time, refreshed every `intervalMs` (ages such as "hace 2 min" stay right). */
export function useNow(clock: () => number, intervalMs = 15_000): number {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const timer = setInterval(() => setNow(clock()), intervalMs);
    return () => clearInterval(timer);
  }, [clock, intervalMs]);
  return now;
}
