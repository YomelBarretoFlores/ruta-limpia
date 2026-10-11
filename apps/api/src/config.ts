import { z } from 'zod';

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: positiveInt(10),
  MIGRATE_ON_START: z.stringbool().default(true),
  INGEST_TOKEN: z.string().min(32, 'INGEST_TOKEN must be at least 32 characters long'),
  TRIP_START_ZONE_METERS: positiveInt(150),
  TRIP_INACTIVITY_TIMEOUT_SEC: positiveInt(30 * 60),
  TRIP_INACTIVITY_CHECK_INTERVAL_SEC: positiveInt(60),
  SHUTDOWN_TIMEOUT_SEC: positiveInt(10),
});

type RawConfig = z.infer<typeof configSchema>;

export interface AppConfig {
  readonly env: RawConfig['NODE_ENV'];
  readonly host: string;
  readonly port: number;
  readonly logLevel: RawConfig['LOG_LEVEL'];
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  /** Apply pending migrations when the API starts. */
  readonly migrateOnStart: boolean;
  readonly ingestToken: string;
  /** A trip auto-starts only when a fix lies within this distance of the route start. */
  readonly tripStartZoneMeters: number;
  /** An active trip without fixes for this long is aborted. */
  readonly tripInactivityTimeoutSec: number;
  readonly tripInactivityCheckIntervalSec: number;
  /** Graceful-shutdown deadline before the process is forced to exit. */
  readonly shutdownTimeoutSec: number;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * `VAR=` in a `.env` file or a compose `environment:` entry yields an empty string. It means "not
 * set", so the default applies (or a required variable is reported as missing).
 */
function withoutEmptyValues(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '',
    ),
  );
}

/**
 * Parses and validates the process environment. Throws a ConfigError listing every invalid
 * variable so the process fails fast at startup instead of misbehaving later.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(withoutEmptyValues(env));
  if (!result.success) {
    throw new ConfigError(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  const raw = result.data;
  return {
    env: raw.NODE_ENV,
    host: raw.HOST,
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL,
    databaseUrl: raw.DATABASE_URL,
    databasePoolMax: raw.DATABASE_POOL_MAX,
    migrateOnStart: raw.MIGRATE_ON_START,
    ingestToken: raw.INGEST_TOKEN,
    tripStartZoneMeters: raw.TRIP_START_ZONE_METERS,
    tripInactivityTimeoutSec: raw.TRIP_INACTIVITY_TIMEOUT_SEC,
    tripInactivityCheckIntervalSec: raw.TRIP_INACTIVITY_CHECK_INTERVAL_SEC,
    shutdownTimeoutSec: raw.SHUTDOWN_TIMEOUT_SEC,
  };
}
