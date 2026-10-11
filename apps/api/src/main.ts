import { pino } from 'pino';

import { composeApi } from './composition-root.js';
import { loadConfig } from './config.js';
import { createDatabase } from './shared/infrastructure/db/database.js';
import { migrateToLatest } from './shared/infrastructure/db/migrator.js';
import { systemClock } from './shared/infrastructure/system-clock.js';
import { createShutdown } from './shutdown.js';

/** Time kept for closing the database pool after the best-effort alert dispatch wait. */
const SHUTDOWN_RESERVE_MS = 1_000;

/** Composition root: reads configuration, wires adapters and starts the HTTP server and jobs. */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const db = createDatabase(config.databaseUrl, { poolMax: config.databasePoolMax });

  if (config.migrateOnStart) await migrateToLatest(db, logger.child({ component: 'migrations' }));

  const api = await composeApi({ config, db, clock: systemClock, logger });

  const shutdown = createShutdown({
    steps: [
      { name: 'inactivity job', run: () => api.inactivityJob.stop() },
      { name: 'http server', run: () => api.app.close() },
      {
        // Pushes still in flight get what is left of the budget, minus a reserve for the pool.
        name: 'alert dispatch',
        run: () => api.ingestPosition.whenNotificationsSettled(),
        reserveMs: SHUTDOWN_RESERVE_MS,
      },
      { name: 'database pool', run: () => db.destroy() },
    ],
    timeoutMs: config.shutdownTimeoutSec * 1000,
    logger,
    exit: (code) => process.exit(code),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    now: () => Date.now(),
  });
  process.once('SIGINT', (signal) => void shutdown(signal));
  process.once('SIGTERM', (signal) => void shutdown(signal));

  await api.app.listen({ host: config.host, port: config.port });
  api.inactivityJob.start();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
