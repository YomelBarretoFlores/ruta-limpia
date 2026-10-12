/**
 * Purges the households' personal data older than a cutoff (see `docs/ops/data-retention.md`):
 *
 *   node dist/privacy/infrastructure/purge-cli.js [--before YYYY-MM-DD] [--dry-run]
 *
 * Without `--before` the cutoff is the default retention end (20 December 2027, 12 months after
 * the pilot; to be confirmed with the municipality). A cutoff after today is refused. Reads
 * DATABASE_URL. Prints what was (or, with `--dry-run`, would be) changed.
 */
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { createDatabase } from '../../shared/infrastructure/db/database.js';
import { systemClock } from '../../shared/infrastructure/system-clock.js';
import { resolveCutoff } from '../domain/retention-policy.js';
import { purgePersonalData } from './kysely-personal-data-purge.js';

const envSchema = z.object({ DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) });

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      before: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const now = systemClock.now();
  const resolved = resolveCutoff(values.before, now);
  if (resolved.status === 'invalid_date') {
    throw new Error('--before must be a calendar date: YYYY-MM-DD.');
  }
  if (resolved.status === 'in_future') {
    throw new Error(
      `The cutoff ${resolved.date} is after today: personal data are kept until then. ` +
        'Pass an earlier --before only if the municipality approved a shorter period.',
    );
  }
  const env = envSchema.parse(process.env);
  const dryRun = values['dry-run'];

  const db = createDatabase(env.DATABASE_URL, { poolMax: 2 });
  try {
    const summary = await purgePersonalData(db, { cutoff: resolved.cutoff, now, dryRun });
    const verb = dryRun ? 'Would purge' : 'Purged';
    process.stdout.write(
      [
        `${verb} personal data older than ${resolved.date} (America/Lima):`,
        `  households anonymized:            ${summary.householdsAnonymized}`,
        `  links to them cleared:            ${summary.householdLinksCleared}`,
        `  app views unlinked:               ${summary.viewsUnlinked}`,
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
