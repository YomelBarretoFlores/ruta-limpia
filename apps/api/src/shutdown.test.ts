import { describe, expect, it, vi } from 'vitest';

import { SILENT_LOGGER } from './shared/application/logger.js';
import { createShutdown, type ShutdownDependencies } from './shutdown.js';

function setup(overrides: Partial<ShutdownDependencies> = {}) {
  const calls: string[] = [];
  const step = (name: string) => () => {
    calls.push(name);
    return Promise.resolve();
  };
  let deadline: (() => void) | undefined;
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
    setTimer: vi.fn((callback: () => void) => {
      deadline = callback;
      return { unref };
    }),
    ...overrides,
  };
  return {
    deps,
    calls,
    unref,
    logError,
    fireDeadline: () => deadline?.(),
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
});
