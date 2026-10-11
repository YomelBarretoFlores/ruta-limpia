/** A page view is reported at most this often (page load excepted). */
export const VIEW_REPORT_INTERVAL_MS = 5 * 60_000;

export interface ViewReporterOptions {
  readonly send: () => Promise<void>;
  readonly now: () => number;
  readonly minIntervalMs?: number;
}

export interface ViewReporter {
  /** Reports a view unless one was reported within the interval; true when it was sent. */
  report(): boolean;
}

/**
 * Throttles the app views of the adoption indicator: the first report (page load) is always
 * sent, later ones (the page became visible again) only after `minIntervalMs`. Failures are
 * ignored: usage logging must never disturb the household.
 */
export function createViewReporter({
  send,
  now,
  minIntervalMs = VIEW_REPORT_INTERVAL_MS,
}: ViewReporterOptions): ViewReporter {
  let lastReportAt: number | null = null;
  return {
    report() {
      const at = now();
      if (lastReportAt !== null && at - lastReportAt < minIntervalMs) return false;
      lastReportAt = at;
      send().catch(() => undefined);
      return true;
    },
  };
}
