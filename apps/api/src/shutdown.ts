import type { Logger } from './shared/application/logger.js';

/** One resource to release on shutdown, in order. */
export interface ShutdownStep {
  readonly name: string;
  run(): Promise<void>;
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
}

/**
 * Builds the signal handler that shuts the API down gracefully: it runs the steps in order and
 * exits with 0, or with 1 when a step fails or the deadline passes first. Later signals are ignored
 * while a shutdown is in progress.
 */
export function createShutdown(deps: ShutdownDependencies): (signal: string) => Promise<void> {
  let shuttingDown = false;
  return async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    deps.logger.info({ signal }, 'Shutting down');
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
        await step.run();
      }
    } catch (error) {
      deps.logger.error({ err: error, step: current?.name }, 'Shutdown failed');
      deps.exit(1);
      return;
    }
    deps.exit(0);
  };
}
