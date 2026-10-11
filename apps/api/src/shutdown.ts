import type { Logger } from './shared/application/logger.js';

/** One resource to release on shutdown, in order. */
export interface ShutdownStep {
  readonly name: string;
  run(): Promise<void>;
  /**
   * Makes the step best-effort: it may wait only until this many milliseconds before the deadline,
   * then shutdown moves on (with a warning) so the later steps, such as closing the database,
   * still run. Without it, the step may use the whole budget.
   */
  readonly reserveMs?: number;
}

export interface ShutdownDependencies {
  /** Released one after the other: stop producing work first, close storage last. */
  readonly steps: readonly ShutdownStep[];
  /** Hard deadline: a stuck request or connection must not keep the process alive forever. */
  readonly timeoutMs: number;
  readonly logger: Logger;
  readonly exit: (code: number) => void;
  /** `setTimeout` in production; the returned timer is unref'd so it never delays a clean exit. */
  readonly setTimer: (callback: () => void, ms: number) => { unref(): void };
  /** Milliseconds since an arbitrary origin (`Date.now` in production). */
  readonly now: () => number;
}

/**
 * Builds the signal handler that shuts the API down gracefully: it runs the steps in order and
 * exits with 0, or with 1 when a step fails or the deadline passes first. Best-effort steps are cut
 * short so the steps after them keep their share of the budget. Later signals are ignored while a
 * shutdown is in progress.
 */
export function createShutdown(deps: ShutdownDependencies): (signal: string) => Promise<void> {
  let shuttingDown = false;
  return async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    deps.logger.info({ signal }, 'Shutting down');
    const deadlineAt = deps.now() + deps.timeoutMs;
    deps
      .setTimer(() => {
        deps.logger.error({ timeoutMs: deps.timeoutMs }, 'Shutdown deadline exceeded');
        deps.exit(1);
      }, deps.timeoutMs)
      .unref();

    let current: ShutdownStep | undefined;
    try {
      for (const step of deps.steps) {
        current = step;
        if (step.reserveMs === undefined) await step.run();
        else await runBestEffort(step, Math.max(0, deadlineAt - step.reserveMs - deps.now()), deps);
      }
    } catch (error) {
      deps.logger.error({ err: error, step: current?.name }, 'Shutdown failed');
      deps.exit(1);
      return;
    }
    deps.exit(0);
  };
}

async function runBestEffort(
  step: ShutdownStep,
  waitMs: number,
  deps: ShutdownDependencies,
): Promise<void> {
  let timedOut = false;
  const timeout = new Promise<void>((resolve) => {
    deps
      .setTimer(() => {
        timedOut = true;
        resolve();
      }, waitMs)
      .unref();
  });
  await Promise.race([step.run(), timeout]);
  if (timedOut) {
    deps.logger.warn(
      { step: step.name, waitedMs: waitMs },
      'Shutdown step did not finish in time; continuing',
    );
  }
}
