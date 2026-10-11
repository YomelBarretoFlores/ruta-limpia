import { describe, expect, it, vi } from 'vitest';

import { formatSchedule } from '../schedule';
import { createViewReporter, VIEW_REPORT_INTERVAL_MS } from './view-reporter';

describe('createViewReporter', () => {
  it('sends the first view, then at most one every 5 minutes', () => {
    let now = 0;
    const send = vi.fn(() => Promise.resolve());
    const reporter = createViewReporter({ send, now: () => now });

    expect(reporter.report()).toBe(true);
    now = VIEW_REPORT_INTERVAL_MS - 1;
    expect(reporter.report()).toBe(false);
    now = VIEW_REPORT_INTERVAL_MS;
    expect(reporter.report()).toBe(true);

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('ignores failures of the usage log', async () => {
    const send = vi.fn(() => Promise.reject(new Error('offline')));
    const reporter = createViewReporter({ send, now: () => 0 });

    expect(reporter.report()).toBe(true);
    await Promise.resolve();
    expect(send).toHaveBeenCalledOnce();
  });
});

describe('formatSchedule', () => {
  it('joins consecutive days with the same start, Monday first', () => {
    expect(
      formatSchedule([
        { weekday: 0, plannedStart: '09:00' },
        { weekday: 1, plannedStart: '07:00' },
        { weekday: 2, plannedStart: '07:00' },
        { weekday: 4, plannedStart: '07:00' },
        { weekday: 5, plannedStart: '07:00' },
        { weekday: 6, plannedStart: '07:00' },
      ]),
    ).toEqual(['Lunes y martes: 07:00', 'Jueves a sábado: 07:00', 'Domingo: 09:00']);
    expect(formatSchedule([])).toEqual([]);
  });
});
