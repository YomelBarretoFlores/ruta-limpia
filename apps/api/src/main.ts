import { pino } from 'pino';

import { composeApi } from './composition-root.js';
import { loadConfig } from './config.js';
import { createDatabase } from './shared/infrastructure/db/database.js';
import { migrateToLatest } from './shared/infrastructure/db/migrator.js';
import { systemClock } from './shared/infrastructure/system-clock.js';

/** Composition root: reads configuration, wires adapters and starts the HTTP server and jobs. */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const db = createDatabase(config.databaseUrl, { poolMax: config.databasePoolMax });

  if (config.migrateOnStart) await migrateToLatest(db, logger.child({ component: 'migrations' }));

  const api = await composeApi({ config, db, clock: systemClock, logger });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    // Hard deadline: a stuck connection or request must not keep the process alive forever.
    setTimeout(() => {
      logger.error({ timeoutSec: config.shutdownTimeoutSec }, 'Shutdown deadline exceeded');
      process.exit(1);
    }, config.shutdownTimeoutSec * 1000).unref();
    try {
      await api.inactivityJob.stop();
      await api.app.close();
      await db.destroy();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Shutdown failed');
      process.exit(1);
    }
  };
  process.once('SIGINT', (signal) => void shutdown(signal));
  process.once('SIGTERM', (signal) => void shutdown(signal));

  await api.app.listen({ host: config.host, port: config.port });
  api.inactivityJob.start();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
