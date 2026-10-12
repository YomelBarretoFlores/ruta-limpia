import { resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The production backup scripts (`infra/prod/backup/`) run against a real PostgreSQL 16, in the
 * same image as the `backup` service (postgres:16-alpine, BusyBox shell). The scripts are mounted
 * read-only, like in production, and run with `PGHOST=127.0.0.1` against the container's own
 * server, which holds an application database and a `traccar` database.
 */
const IMAGE = 'postgres:16-alpine';
const SCRIPTS = resolve(import.meta.dirname, '../../../../infra/prod/backup');
const APP_DB = 'ruta_limpia';

let pg: StartedPostgreSqlContainer;

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a shell command in the container, as the backup service would. */
async function sh(command: string, env: Record<string, string> = {}): Promise<Run> {
  const result = await pg.exec(['sh', '-c', command], { env: { PGHOST: '127.0.0.1', ...env } });
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

async function ok(command: string): Promise<string> {
  const run = await sh(command);
  if (run.exitCode !== 0) throw new Error(`${command} failed (${run.exitCode}): ${run.stderr}`);
  return run.stdout;
}

/** Runs one SQL statement as the superuser and returns the unaligned result. */
const psql = (database: string, statement: string) =>
  ok(
    `psql -U "$POSTGRES_USER" -h 127.0.0.1 -d ${database} -tA -v ON_ERROR_STOP=1 -c "${statement}"`,
  ).then((out) => out.trim());

const databases = async () =>
  (await psql('postgres', 'SELECT datname FROM pg_database ORDER BY datname')).split('\n');

const files = async (dir: string) =>
  (await ok(`ls -1 ${dir} 2>/dev/null || true`)).split('\n').filter((name) => name !== '');

/** Creates (or recreates) a database with one table of `rows` labelled rows. */
async function seed(database: string, label: string, rows: number): Promise<void> {
  await ok(`dropdb -U "$POSTGRES_USER" -h 127.0.0.1 --if-exists --force ${database}`);
  await ok(`createdb -U "$POSTGRES_USER" -h 127.0.0.1 ${database}`);
  await psql(
    database,
    `CREATE TABLE sample (id int PRIMARY KEY, label text NOT NULL, filler text NOT NULL);` +
      `INSERT INTO sample SELECT n, '${label}', md5(n::text) || md5((n * 7)::text) FROM generate_series(1, ${rows}) n`,
  );
}

const labelOf = (database: string) => psql(database, 'SELECT DISTINCT label FROM sample');

beforeAll(async () => {
  pg = await new PostgreSqlContainer(IMAGE)
    .withDatabase(APP_DB)
    .withUsername('ruta_limpia')
    .withPassword('backup-test-password')
    .withBindMounts([{ source: SCRIPTS, target: '/opt/backup', mode: 'ro' }])
    .start();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await ok('rm -rf /backups && mkdir -p /backups');
  await seed(APP_DB, 'app', 200);
  await seed('traccar', 'traccar', 50);
});

describe('backup.sh', () => {
  it('dumps both databases into readable, root-only files, leaving no partial file', async () => {
    const run = await sh('sh /opt/backup/backup.sh');

    expect(run.exitCode).toBe(0);
    const daily = await files('/backups/daily');
    expect(daily.filter((f) => f.startsWith(`${APP_DB}-`) && f.endsWith('.dump'))).toHaveLength(1);
    expect(daily.filter((f) => f.startsWith('traccar-') && f.endsWith('.dump'))).toHaveLength(1);
    expect(daily.some((f) => f.endsWith('.partial'))).toBe(false);
    expect(await ok('stat -c %a /backups/daily/*.dump | sort -u')).toBe('600\n');
    await ok('for f in /backups/daily/*.dump; do pg_restore --list "$f" >/dev/null; done');
  });

  it('still dumps Traccar when the application dump fails, and reports the failure', async () => {
    const run = await sh('sh /opt/backup/backup.sh', { POSTGRES_DB: 'missing_db' });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toMatch(/FAILED.*missing_db/);
    const daily = await files('/backups/daily');
    expect(daily.filter((f) => f.startsWith('traccar-') && f.endsWith('.dump'))).toHaveLength(1);
    expect(daily.some((f) => f.endsWith('.partial'))).toBe(false);
  });

  it('keeps the application dump when the Traccar dump fails, and reports the failure', async () => {
    await ok('dropdb -U "$POSTGRES_USER" -h 127.0.0.1 --force traccar');

    const run = await sh('sh /opt/backup/backup.sh');

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toMatch(/FAILED.*traccar/);
    const daily = await files('/backups/daily');
    expect(daily.filter((f) => f.startsWith(`${APP_DB}-`) && f.endsWith('.dump'))).toHaveLength(1);
    expect(daily.some((f) => f.startsWith('traccar-'))).toBe(false);
  });

  it('rotates each database to BACKUP_KEEP_DAILY copies and removes stale partial files', async () => {
    await ok(
      'mkdir -p /backups/daily && cd /backups/daily && ' +
        `for d in 20200101 20200102 20200103; do touch ${APP_DB}-$d-0330.dump traccar-$d-0330.dump; done && ` +
        `touch -d '2020-01-04 03:30' ${APP_DB}-20200104-0330.dump.partial`,
    );

    const run = await sh('sh /opt/backup/backup.sh', { BACKUP_KEEP_DAILY: '2' });

    expect(run.exitCode).toBe(0);
    const daily = await files('/backups/daily');
    const app = daily.filter((f) => f.startsWith(`${APP_DB}-`)).sort();
    const traccar = daily.filter((f) => f.startsWith('traccar-')).sort();
    // The newest two of each: today's dump and 2020-01-03.
    expect(app).toHaveLength(2);
    expect(app[0]).toBe(`${APP_DB}-20200103-0330.dump`);
    expect(traccar).toHaveLength(2);
    expect(traccar[0]).toBe('traccar-20200103-0330.dump');
    expect(daily.some((f) => f.endsWith('.partial'))).toBe(false);
  });
});

describe('healthcheck.sh', () => {
  it('is healthy only while each database has a dump younger than 26 hours', async () => {
    await ok('sh /opt/backup/backup.sh');
    expect((await sh('sh /opt/backup/healthcheck.sh')).exitCode).toBe(0);

    // Traccar's dumps keep failing: its newest dump is two days old, the application's is fresh.
    await ok(
      `touch -d "$(date -d @$(( $(date +%s) - 172800 )) '+%Y-%m-%d %H:%M')" /backups/daily/traccar-*.dump`,
    );
    const stale = await sh('sh /opt/backup/healthcheck.sh');

    expect(stale.exitCode).not.toBe(0);
    expect(stale.stderr).toMatch(/traccar/);
  });
});

describe('run.sh', () => {
  it.each(['24:00', '29:59', '3:30', '03:60'])(
    'refuses BACKUP_TIME=%s at start instead of never running',
    async (time) => {
      const run = await sh('timeout 10 sh /opt/backup/run.sh', { BACKUP_TIME: time });

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toMatch(/BACKUP_TIME/);
      expect(await files('/backups/daily')).toEqual([]);
    },
  );
});

describe('restore.sh', () => {
  const dumpOf = async (database: string) => {
    await ok('sh /opt/backup/backup.sh');
    return `/backups/daily/${(await files('/backups/daily')).find((f) => f.startsWith(`${database}-`))!}`;
  };

  it('restores into a new database and refuses an existing one without --replace', async () => {
    const dump = await dumpOf(APP_DB);

    expect((await sh(`sh /opt/backup/restore.sh ${dump} ruta_limpia_restore_check`)).exitCode).toBe(
      0,
    );
    expect(await labelOf('ruta_limpia_restore_check')).toBe('app');
    expect(await psql('ruta_limpia_restore_check', 'SELECT count(*) FROM sample')).toBe('200');

    const again = await sh(`sh /opt/backup/restore.sh ${dump} ruta_limpia_restore_check`);
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toMatch(/--replace/);
  });

  it('replaces the live database only after the restored copy is complete', async () => {
    const dump = await dumpOf(APP_DB);
    await seed(APP_DB, 'live', 10);

    const run = await sh(`sh /opt/backup/restore.sh ${dump} ${APP_DB} --replace`);

    expect(run.exitCode).toBe(0);
    expect(await labelOf(APP_DB)).toBe('app');
    expect(await databases()).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/_restoring$|_previous$/)]),
    );
  });

  it('leaves the live database untouched when the restore fails part-way', async () => {
    const dump = await dumpOf(APP_DB);
    await seed(APP_DB, 'live', 10);
    // Cut the data off the end: the table of contents still reads, the restore cannot finish.
    await ok(`head -c $(( $(stat -c %s ${dump}) / 2 )) ${dump} > /backups/truncated.dump`);
    await ok('pg_restore --list /backups/truncated.dump >/dev/null');

    const run = await sh(`sh /opt/backup/restore.sh /backups/truncated.dump ${APP_DB} --replace`);

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toMatch(/not changed/);
    expect(await labelOf(APP_DB)).toBe('live');
    expect(await databases()).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/_restoring$|_previous$/)]),
    );
  });

  it('refuses a target name it cannot quote safely', async () => {
    const dump = await dumpOf(APP_DB);

    const run = await sh(`sh /opt/backup/restore.sh ${dump} 'Ruta-Limpia'`);

    expect(run.exitCode).toBe(2);
    expect(await databases()).not.toContain('Ruta-Limpia');
  });
});
