import { describe, expect, it } from 'vitest';

import { FakeStopwatch } from '../../../test/fakes/in-memory-auth.js';
import { VerificationTiming } from './verification-timing.js';

const OPTIONS = { samples: 3, defaultMs: 400, minMs: 5, maxMs: 6_000 };

async function measured(timing: VerificationTiming, stopwatch: FakeStopwatch, ms: number) {
  await timing.measure(() => {
    stopwatch.advance(ms);
    return Promise.resolve(true);
  });
}

describe('VerificationTiming', () => {
  it('waits the default before any verification was measured', async () => {
    const stopwatch = new FakeStopwatch();
    const timing = new VerificationTiming(stopwatch, OPTIONS);

    await timing.imitate();

    expect(stopwatch.sleeps).toEqual([400]);
  });

  it('waits one of the recent durations, picked at random', async () => {
    const stopwatch = new FakeStopwatch();
    let next = 0;
    const picks = [0, 0.5, 0.99];
    const timing = new VerificationTiming(stopwatch, OPTIONS, () => picks[next++] ?? 0);
    for (const ms of [100, 200, 300]) await measured(timing, stopwatch, ms);

    for (let i = 0; i < 3; i++) await timing.imitate();

    expect(stopwatch.sleeps).toEqual([100, 200, 300]);
  });

  it('keeps only the most recent durations', async () => {
    const stopwatch = new FakeStopwatch();
    const timing = new VerificationTiming(stopwatch, OPTIONS, () => 0);
    for (const ms of [100, 200, 300, 900]) await measured(timing, stopwatch, ms);

    // The oldest (100) was replaced by the newest (900).
    expect(timing.typicalMs()).toBe(900);
  });

  it('keeps each wait within the bounds', async () => {
    const stopwatch = new FakeStopwatch();
    const fast = new VerificationTiming(stopwatch, OPTIONS);
    await measured(fast, stopwatch, 0);
    const slow = new VerificationTiming(stopwatch, OPTIONS);
    await measured(slow, stopwatch, 60_000);

    expect([fast.typicalMs(), slow.typicalMs()]).toEqual([5, 6_000]);
  });

  it('records nothing when a verification fails', async () => {
    const stopwatch = new FakeStopwatch();
    const timing = new VerificationTiming(stopwatch, OPTIONS);

    await expect(timing.measure(() => Promise.reject(new Error('busy')))).rejects.toThrow('busy');

    expect(timing.typicalMs()).toBe(400);
  });
});
