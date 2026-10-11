import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

const validEnv = {
  DATABASE_URL: 'postgres://ruta_limpia:secret@localhost:5432/ruta_limpia',
  INGEST_TOKEN: 'a'.repeat(32),
};

describe('loadConfig', () => {
  it('applies defaults for optional variables', () => {
    const config = loadConfig(validEnv);

    expect(config).toEqual({
      env: 'development',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      databaseUrl: validEnv.DATABASE_URL,
      ingestToken: validEnv.INGEST_TOKEN,
    });
  });

  it('coerces the port from its string form', () => {
    expect(loadConfig({ ...validEnv, PORT: '8080' }).port).toBe(8080);
  });

  it('fails fast when required variables are missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*INGEST_TOKEN/);
  });

  it('rejects a short ingest token', () => {
    expect(() => loadConfig({ ...validEnv, INGEST_TOKEN: 'short' })).toThrow(/at least 32/);
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      ConfigError,
    );
  });
});
