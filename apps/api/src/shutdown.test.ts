import { describe, expect, it, vi } from 'vitest';

import { SILENT_LOGGER } from './shared/application/logger.js';
import { createShutdown, type ShutdownDependencies } from './shutdown.js';

function setup(overrides: Partial<ShutdownDependencies> = {}) {
  const calls: string[] = [];
  const step = (name: string) => () => {
    calls.push(name);
    return Promise.resolve();
  };
  let clock = 0;
  /** Every timer set, in order: the deadline first, then the best-effort step waits. */
  const timers: { callback: () => void; ms: number }[] = [];
  const unref = vi.fn();
  const logError = vi.fn();
  const deps: ShutdownDependencies = {
    steps: [
      { name: 'inactivity job', run: step('job.stop') },
      { name: 'http server', run: step('app.close') },
      { name: 'database pool', run: step('db.destroy') },
    ],
    timeoutMs: 10_000,
    logger: { ...SILENT_LOGGER, error: logError },
    exit: vi.fn((code: number) => {
      calls.push(`exit(${code})`);
    }),
    setTimer: vi.fn((callback: () => void, ms: number) => {
      timers.push({ callback, ms });
      return { unref };
    }),
    now: () => clock,
    ...overrides,
  };
  return {
    deps,
    calls,
    unref,
    logError,
    timers,
    advance: (ms: number) => {
      clock += ms;
    },
    fireDeadline: () => timers[0]?.callback(),
    shutdown: createShutdown(deps),
  };
}

describe('createShutdown', () => {
  it('stops the job, closes the server, then the database, and exits with 0', async () => {
    const { shutdown, calls, deps, unref } = setup();

    await shutdown('SIGTERM');

    expect(calls).toEqual(['job.stop', 'app.close', 'db.destroy', 'exit(0)']);
    expect(deps.setTimer).toHaveBeenCalledWith(expect.any(Function), 10_000);
    expect(unref).toHaveBeenCalledOnce();
  });

  it('runs only once when a second signal arrives', async () => {
    const { shutdown, calls } = setup();

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
    await shutdown('SIGTERM');

    expect(calls).toEqual(['job.stop', 'app.close', 'db.destroy', 'exit(0)']);
  });

  it('exits with 1 when a step fails, without running the later steps', async () => {
    const calls: string[] = [];
    const { shutdown, logError } = setup({
      steps: [
        { name: 'inactivity job', run: () => Promise.resolve(void calls.push('job.stop')) },
        { name: 'http server', run: () => Promise.reject(new Error('close failed')) },
        { name: 'database pool', run: () => Promise.resolve(void calls.push('db.destroy')) },
      ],
      exit: (code) => void calls.push(`exit(${code})`),
    });

    await shutdown('SIGTERM');

    expect(calls).toEqual(['job.stop', 'exit(1)']);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) as unknown, step: 'http server' }),
      'Shutdown failed',
    );
  });

  it('forces exit code 1 when the deadline passes before the steps finish', async () => {
    const { shutdown, calls, logError, fireDeadline } = setup({
      steps: [{ name: 'http server', run: () => new Promise<void>(() => undefined) }],
    });

    void shutdown('SIGTERM');
    await Promise.resolve();
    fireDeadline();

    expect(calls).toEqual(['exit(1)']);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 10_000 }),
      'Shutdown deadline exceeded',
    );
  });
  it('bounds a best-effort step by the remaining budget so the database still closes', async () => {
    const calls: string[] = [];
    const logWarn = vi.fn();
    let advanceClock: (ms: number) => void = () => undefined;
    const ctx = setup({
      steps: [
        {
          name: 'http server',
          run: () => {
            advanceClock(2_500); // draining the open requests took 2.5 s
            calls.push('app.close');
            return Promise.resolve();
          },
        },
        // A slow push service: the background alert dispatch does not settle on its own.
        { name: 'alert dispatch', run: () => new Promise<void>(() => undefined), reserveMs: 1_000 },
        { name: 'database pool', run: () => Promise.resolve(void calls.push('db.destroy')) },
      ],
      logger: { ...SILENT_LOGGER, warn: logWarn },
      exit: (code) => void calls.push(`exit(${code})`),
    });
    advanceClock = ctx.advance;

    const done = ctx.shutdown('SIGTERM');
    await vi.waitFor(() => expect(ctx.timers).toHaveLength(2));
    expect(ctx.timers[1]?.ms).toBe(10_000 - 2_500 - 1_000);
    ctx.timers[1]?.callback();
    await done;

    expect(calls).toEqual(['app.close', 'db.destroy', 'exit(0)']);
    expect(logWarn).toHaveBeenCalledWith(
      { step: 'alert dispatch', waitedMs: 6_500 },
      'Shutdown step did not finish in time; continuing',
    );
  });

  it('runs a best-effort step to completion when it finishes in time', async () => {
    const calls: string[] = [];
    const { shutdown } = setup({
      steps: [
        {
          name: 'alert dispatch',
          run: () => Promise.resolve(void calls.push('dispatch')),
          reserveMs: 1_000,
        },
        { name: 'database pool', run: () => Promise.resolve(void calls.push('db.destroy')) },
      ],
      exit: (code) => void calls.push(`exit(${code})`),
    });

    await shutdown('SIGTERM');

    expect(calls).toEqual(['dispatch', 'db.destroy', 'exit(0)']);
  });
});
