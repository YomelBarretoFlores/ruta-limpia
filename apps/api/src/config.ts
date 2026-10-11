import { z } from 'zod';

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const base64Url = z.string().regex(/^[A-Za-z0-9_-]+$/, 'must be base64url without padding');

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: positiveInt(10),
    MIGRATE_ON_START: z.stringbool().default(true),
    INGEST_TOKEN: z.string().min(32, 'INGEST_TOKEN must be at least 32 characters long'),
    TRIP_START_ZONE_METERS: positiveInt(150),
    TRIP_INACTIVITY_TIMEOUT_SEC: positiveInt(30 * 60),
    TRIP_INACTIVITY_CHECK_INTERVAL_SEC: positiveInt(60),
    ETA_REFRESH_INTERVAL_SEC: positiveInt(15),
    SSE_MAX_CONNECTIONS: positiveInt(500),
    MAX_FIX_FUTURE_SKEW_SEC: positiveInt(120),
    SHUTDOWN_TIMEOUT_SEC: positiveInt(10),
    TRUST_PROXY: z.stringbool().default(false),
    PUBLIC_RATE_LIMIT_PER_MINUTE: positiveInt(20),
    PUSH_CONCURRENCY: positiveInt(8),
    PUSH_MAX_CONSECUTIVE_FAILURES: positiveInt(5),
    VAPID_PUBLIC_KEY: base64Url.length(87, 'VAPID_PUBLIC_KEY must be 87 characters').optional(),
    VAPID_PRIVATE_KEY: base64Url.length(43, 'VAPID_PRIVATE_KEY must be 43 characters').optional(),
    VAPID_SUBJECT: z
      .string()
      .regex(/^(mailto:|https:\/\/)\S+$/, 'VAPID_SUBJECT must be a mailto: or https: URL')
      .optional(),
  })
  .refine(
    (env) => {
      const set = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT];
      return set.every((v) => v === undefined) || set.every((v) => v !== undefined);
    },
    {
      message: 'Set all of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT, or none',
      path: ['VAPID_PUBLIC_KEY'],
    },
  );

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
  /** How often the ETAs of active trips are recomputed and republished between fixes. */
  readonly etaRefreshIntervalSec: number;
  /** Open live streams (SSE) across all routes; more answer 503. */
  readonly sseMaxConnections: number;
  /** A fix dated more than this ahead of the server clock is ignored (202, never stored). */
  readonly maxFixFutureSkewSec: number;
  /** Graceful-shutdown deadline before the process is forced to exit. */
  readonly shutdownTimeoutSec: number;
  /** Trust `X-Forwarded-*` from the reverse proxy (client IPs for rate limiting). */
  readonly trustProxy: boolean;
  /** Per client IP and route, for the public mutating routes (subscriptions). */
  readonly publicRateLimitPerMinute: number;
  /** Pushes sent at the same time for one alert. */
  readonly pushConcurrency: number;
  /** A subscription is revoked after this many failed pushes in a row. */
  readonly pushMaxConsecutiveFailures: number;
  /** Web Push (VAPID) credentials; null disables push (alerts are then only logged). */
  readonly vapid: VapidConfig | null;
}

export interface VapidConfig {
  readonly publicKey: string;
  readonly privateKey: string;
  /** Contact for the push services: `mailto:` or `https:` URL. */
  readonly subject: string;
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
    etaRefreshIntervalSec: raw.ETA_REFRESH_INTERVAL_SEC,
    sseMaxConnections: raw.SSE_MAX_CONNECTIONS,
    maxFixFutureSkewSec: raw.MAX_FIX_FUTURE_SKEW_SEC,
    shutdownTimeoutSec: raw.SHUTDOWN_TIMEOUT_SEC,
    trustProxy: raw.TRUST_PROXY,
    publicRateLimitPerMinute: raw.PUBLIC_RATE_LIMIT_PER_MINUTE,
    pushConcurrency: raw.PUSH_CONCURRENCY,
    pushMaxConsecutiveFailures: raw.PUSH_MAX_CONSECUTIVE_FAILURES,
    vapid:
      raw.VAPID_PUBLIC_KEY !== undefined &&
      raw.VAPID_PRIVATE_KEY !== undefined &&
      raw.VAPID_SUBJECT !== undefined
        ? {
            publicKey: raw.VAPID_PUBLIC_KEY,
            privateKey: raw.VAPID_PRIVATE_KEY,
            subject: raw.VAPID_SUBJECT,
          }
        : null,
  };
}
