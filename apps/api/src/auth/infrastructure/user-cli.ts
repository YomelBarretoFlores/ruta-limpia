/**
 * Creates a panel user from the command line (for example the first administrator):
 *
 *   pnpm --filter api user:create --username ana.torres --role admin [--display-name "Ana Torres"]
 *
 * The password is read from standard input, never from the arguments (they end up in the shell
 * history and the process list). On a terminal it is asked twice without echo; otherwise the first
 * line of the piped input is used: `printf '%s\n' "$PASSWORD" | pnpm --filter api user:create ...`.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { createDatabase } from '../../shared/infrastructure/db/database.js';
import { KyselyAuditLog } from '../../shared/infrastructure/audit/kysely-audit-log.js';
import { systemClock } from '../../shared/infrastructure/system-clock.js';
import { UserAdminService } from '../application/user-admin-service.js';
import { ROLES } from '../domain/role.js';
import { KyselySessionStore, KyselyUserStore } from './kysely-auth-stores.js';
import { ScryptPasswordHasher } from './scrypt-password-hasher.js';

const envSchema = z.object({ DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) });

const argsSchema = z.object({
  username: z.string().min(1),
  role: z.enum(ROLES),
  'display-name': z.string().min(1).max(80).optional(),
});

/** Reads one line without echoing it (terminal). */
function askHidden(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  const muted = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
  });
}

/** The first line of the piped standard input. */
async function readFirstLine(): Promise<string> {
  const rl = createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    rl.close();
    return line;
  }
  return '';
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return readFirstLine();
  const first = await askHidden('Password (12+ characters): ');
  const second = await askHidden('Repeat the password: ');
  if (first !== second) throw new Error('The passwords do not match.');
  return first;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      username: { type: 'string' },
      role: { type: 'string' },
      'display-name': { type: 'string' },
    },
    strict: true,
  });
  const args = argsSchema.parse(values);
  const env = envSchema.parse(process.env);
  const password = await readPassword();

  const db = createDatabase(env.DATABASE_URL, { poolMax: 2 });
  try {
    const users = new KyselyUserStore(db);
    const service = new UserAdminService({
      users,
      sessions: new KyselySessionStore(db),
      hasher: new ScryptPasswordHasher(),
      audit: new KyselyAuditLog(db),
      clock: systemClock,
    });
    const result = await service.create(
      {
        username: args.username,
        displayName: args['display-name'] ?? args.username,
        role: args.role,
        password,
      },
      null,
    );
    if (result.status !== 'ok') {
      const detail = result.status === 'weak_password' ? ` (${result.problem})` : '';
      throw new Error(`User not created: ${result.status}${detail}`);
    }
    process.stdout.write(
      `Created ${result.user.role} "${result.user.username}" (${result.user.id})\n`,
    );
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
