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
      databasePoolMax: 10,
      migrateOnStart: true,
      ingestToken: validEnv.INGEST_TOKEN,
      tripStartZoneMeters: 150,
      tripInactivityTimeoutSec: 1800,
      tripInactivityCheckIntervalSec: 60,
      etaRefreshIntervalSec: 15,
      sseMaxConnections: 500,
      maxFixFutureSkewSec: 120,
      shutdownTimeoutSec: 10,
      trustProxy: false,
      publicRateLimitPerMinute: 20,
      sessionCookieSecure: true,
      sessionIdleMinutes: 480,
      sessionAbsoluteHours: 168,
      loginRateLimitPerMinute: 10,
      publicOrigin: null,
      pushConcurrency: 8,
      pushMaxConsecutiveFailures: 5,
      vapid: null,
    });
  });

  it('reads the VAPID credentials when all three are set', () => {
    const vapid = {
      VAPID_PUBLIC_KEY: 'B'.repeat(87),
      VAPID_PRIVATE_KEY: 'k'.repeat(43),
      VAPID_SUBJECT: 'mailto:municipalidad@example.org',
    };

    expect(loadConfig({ ...validEnv, ...vapid }).vapid).toEqual({
      publicKey: vapid.VAPID_PUBLIC_KEY,
      privateKey: vapid.VAPID_PRIVATE_KEY,
      subject: vapid.VAPID_SUBJECT,
    });
    expect(() => loadConfig({ ...validEnv, VAPID_PUBLIC_KEY: vapid.VAPID_PUBLIC_KEY })).toThrow(
      /all of VAPID_PUBLIC_KEY/,
    );
    expect(() => loadConfig({ ...validEnv, ...vapid, VAPID_SUBJECT: 'admin' })).toThrow(
      /VAPID_SUBJECT/,
    );
    expect(() => loadConfig({ ...validEnv, ...vapid, VAPID_PRIVATE_KEY: 'short' })).toThrow(
      /VAPID_PRIVATE_KEY/,
    );
  });

  it('coerces numbers and booleans from their string form', () => {
    const config = loadConfig({
      ...validEnv,
      PORT: '8080',
      DATABASE_POOL_MAX: '4',
      MIGRATE_ON_START: 'false',
      TRIP_START_ZONE_METERS: '200',
      TRIP_INACTIVITY_TIMEOUT_SEC: '900',
      TRIP_INACTIVITY_CHECK_INTERVAL_SEC: '30',
      ETA_REFRESH_INTERVAL_SEC: '10',
      SSE_MAX_CONNECTIONS: '50',
      MAX_FIX_FUTURE_SKEW_SEC: '30',
      SHUTDOWN_TIMEOUT_SEC: '5',
      TRUST_PROXY: 'true',
      PUBLIC_RATE_LIMIT_PER_MINUTE: '5',
      PUSH_CONCURRENCY: '4',
      PUSH_MAX_CONSECUTIVE_FAILURES: '3',
    });

    expect(config).toMatchObject({
      port: 8080,
      databasePoolMax: 4,
      migrateOnStart: false,
      tripStartZoneMeters: 200,
      tripInactivityTimeoutSec: 900,
      tripInactivityCheckIntervalSec: 30,
      etaRefreshIntervalSec: 10,
      sseMaxConnections: 50,
      maxFixFutureSkewSec: 30,
      shutdownTimeoutSec: 5,
      trustProxy: true,
      publicRateLimitPerMinute: 5,
      pushConcurrency: 4,
      pushMaxConsecutiveFailures: 3,
    });
  });

  it('reads the panel session settings and normalizes the public origin', () => {
    const config = loadConfig({
      ...validEnv,
      SESSION_COOKIE_SECURE: 'false',
      SESSION_IDLE_MINUTES: '60',
      SESSION_ABSOLUTE_HOURS: '24',
      LOGIN_RATE_LIMIT_PER_MINUTE: '3',
      PUBLIC_ORIGIN: 'https://RutaLimpia.example.org/panel/',
    });

    expect(config).toMatchObject({
      sessionCookieSecure: false,
      sessionIdleMinutes: 60,
      sessionAbsoluteHours: 24,
      loginRateLimitPerMinute: 3,
      publicOrigin: 'https://rutalimpia.example.org',
    });
    expect(() => loadConfig({ ...validEnv, PUBLIC_ORIGIN: 'ftp://example.org' })).toThrow(
      /PUBLIC_ORIGIN/,
    );
  });

  it('treats empty values as unset, so the defaults apply', () => {
    const config = loadConfig({
      ...validEnv,
      HOST: '',
      PORT: '',
      LOG_LEVEL: '',
      DATABASE_POOL_MAX: '',
      MIGRATE_ON_START: '',
      SHUTDOWN_TIMEOUT_SEC: '',
    });

    expect(config).toEqual(loadConfig(validEnv));
  });

  it('reports an empty required variable as missing', () => {
    expect(() => loadConfig({ ...validEnv, INGEST_TOKEN: '' })).toThrow(/INGEST_TOKEN/);
  });

  it('fails fast when required variables are missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*INGEST_TOKEN/);
  });

  it('rejects a short ingest token, such as the .env.example placeholder', () => {
    expect(() => loadConfig({ ...validEnv, INGEST_TOKEN: 'short' })).toThrow(/at least 32/);
    expect(() => loadConfig({ ...validEnv, INGEST_TOKEN: 'change-me' })).toThrow(ConfigError);
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      ConfigError,
    );
  });

  it.each([
    ['MIGRATE_ON_START', 'maybe'],
    ['DATABASE_POOL_MAX', '0'],
    ['TRIP_START_ZONE_METERS', '-5'],
    ['TRIP_INACTIVITY_TIMEOUT_SEC', '1.5'],
    ['SHUTDOWN_TIMEOUT_SEC', 'soon'],
  ])('rejects an invalid %s', (name, value) => {
    expect(() => loadConfig({ ...validEnv, [name]: value })).toThrow(new RegExp(name));
  });
});
