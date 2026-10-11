/**
 * Database command line: `migrate` applies pending migrations, `seed` loads the pilot catalog.
 * Run through `pnpm --filter api db:migrate` / `db:seed`, which load the root `.env`.
 */
import { pino } from 'pino';
import { z } from 'zod';

import { createDatabase } from './database.js';
import { migrateToLatest } from './migrator.js';
import { seedDatabase } from './seed.js';

const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  SEED_VEHICLE_UNIQUE_ID: z.string().min(1).default('ruta-limpia-unidad-a'),
});

async function run(command: string | undefined): Promise<void> {
  const env = envSchema.parse(process.env);
  const logger = pino({ level: 'info' });
  const db = createDatabase(env.DATABASE_URL, { poolMax: 2 });
  try {
    if (command === 'migrate') {
      await migrateToLatest(db, logger);
      logger.info('Database is up to date');
    } else if (command === 'seed') {
      const result = await seedDatabase(db, { vehicleUniqueId: env.SEED_VEHICLE_UNIQUE_ID });
      logger.info({ ...result, vehicleUniqueId: env.SEED_VEHICLE_UNIQUE_ID }, 'Seed applied');
    } else {
      throw new Error(`Unknown command "${command ?? ''}". Use "migrate" or "seed".`);
    }
  } finally {
    await db.destroy();
  }
}

run(process.argv[2]).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
