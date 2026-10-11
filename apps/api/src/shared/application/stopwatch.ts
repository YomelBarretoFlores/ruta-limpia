/** Port: a monotonic timer in milliseconds (for durations, not dates), and a way to wait. */
export interface Stopwatch {
  now(): number;
  sleep(ms: number): Promise<void>;
}
