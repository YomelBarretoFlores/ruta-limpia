/**
 * Purges the households' personal data older than a cutoff (see `docs/ops/data-retention.md`):
 *
 *   node dist/privacy/infrastructure/purge-cli.js [--before YYYY-MM-DD] [--dry-run]
 *
 * Without `--before` the cutoff is the default retention end (20 December 2027, 12 months after
 * the pilot; to be confirmed with the municipality). A cutoff after today, an invalid date or an
 * unknown option is refused before connecting (`purge-cli-args.ts`). Reads
 * DATABASE_URL. Prints what was (or, with `--dry-run`, would be) changed.
 */
import { z } from 'zod';

import { createDatabase } from '../../shared/infrastructure/db/database.js';
import { systemClock } from '../../shared/infrastructure/system-clock.js';
import { purgePersonalData } from './kysely-personal-data-purge.js';
import { parsePurgeArgs } from './purge-cli-args.js';

const envSchema = z.object({ DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) });

async function main(): Promise<void> {
  const now = systemClock.now();
  const command = parsePurgeArgs(process.argv.slice(2), now);
  // Refused before connecting: an invalid or future cutoff never reaches the data.
  if (command.status === 'refused') throw new Error(command.message);
  const env = envSchema.parse(process.env);
  const { cutoff, date, dryRun } = command;

  const db = createDatabase(env.DATABASE_URL, { poolMax: 2 });
  try {
    const summary = await purgePersonalData(db, { cutoff, now, dryRun });
    const verb = dryRun ? 'Would purge' : 'Purged';
    process.stdout.write(
      [
        `${verb} personal data older than ${date} (America/Lima):`,
        `  households anonymized:            ${summary.householdsAnonymized}`,
        `  app views before the cutoff:      ${summary.viewsUnlinked} unlinked`,
        `  later links to those households:  ${summary.householdLinksCleared} cleared`,
        `  later views of deleted devices:   ${summary.viewsOfDeletedSubscriptions} unlinked`,
        `  alert deliveries deleted:         ${summary.deliveriesDeleted}`,
        `  push subscriptions deleted:       ${summary.subscriptionsDeleted}`,
        dryRun ? 'Dry run: nothing was changed.' : 'Recorded in the audit trail (privacy.purge).',
        '',
      ].join('\n'),
    );
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
