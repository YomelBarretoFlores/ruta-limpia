import { parseArgs } from 'node:util';

import { resolveCutoff } from '../domain/retention-policy.js';

/** What `purge-cli` was asked to do, decided before it connects to the database. */
export type PurgeCommand =
  | {
      readonly status: 'run';
      /** The cutoff day (YYYY-MM-DD, America/Lima). */
      readonly date: string;
      readonly cutoff: Date;
      readonly dryRun: boolean;
    }
  | { readonly status: 'refused'; readonly message: string };

/**
 * Parses `[--before YYYY-MM-DD] [--dry-run]`. Refuses unknown options, stray arguments, a date that
 * is not a calendar day and a cutoff after `now`, so a mistyped command never reaches the data.
 */
export function parsePurgeArgs(args: readonly string[], now: Date): PurgeCommand {
  let values: { before?: string | undefined; 'dry-run'?: boolean | undefined };
  try {
    ({ values } = parseArgs({
      args: [...args],
      options: {
        before: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return { status: 'refused', message: error instanceof Error ? error.message : String(error) };
  }
  const resolved = resolveCutoff(values.before, now);
  if (resolved.status === 'invalid_date') {
    return { status: 'refused', message: '--before must be a calendar date: YYYY-MM-DD.' };
  }
  if (resolved.status === 'in_future') {
    return {
      status: 'refused',
      message:
        `The cutoff ${resolved.date} is after today: personal data are kept until then. ` +
        'Pass an earlier --before only if the municipality approved a shorter period.',
    };
  }
  return {
    status: 'run',
    date: resolved.date,
    cutoff: resolved.cutoff,
    dryRun: values['dry-run'] === true,
  };
}
