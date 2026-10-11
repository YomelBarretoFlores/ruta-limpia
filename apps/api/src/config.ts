import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  INGEST_TOKEN: z.string().min(32, 'INGEST_TOKEN must be at least 32 characters long'),
});

type RawConfig = z.infer<typeof configSchema>;

export interface AppConfig {
  readonly env: RawConfig['NODE_ENV'];
  readonly host: string;
  readonly port: number;
  readonly logLevel: RawConfig['LOG_LEVEL'];
  readonly databaseUrl: string;
  readonly ingestToken: string;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * Parses and validates the process environment. Throws a ConfigError listing every invalid
 * variable so the process fails fast at startup instead of misbehaving later.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);
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
    ingestToken: raw.INGEST_TOKEN,
  };
}
