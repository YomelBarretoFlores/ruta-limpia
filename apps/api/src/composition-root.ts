import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

import { LoggingAlertNotifier } from './alerts/infrastructure/logging-alert-notifier.js';
import { DEFAULT_ALERT_SETTINGS } from './alerts/domain/alert-policy.js';
import { buildApp } from './app.js';
import type { AppConfig } from './config.js';
import type { AlertNotifier } from './alerts/application/alert-notifier.js';
import { SpeedProfileProvider } from './eta/application/speed-profile-provider.js';
import { DEFAULT_ETA_SETTINGS } from './eta/domain/eta-settings.js';
import { KyselyCompletedTripSamples } from './eta/infrastructure/kysely-completed-trip-samples.js';
import { RouteCatalog } from './routes/application/route-catalog.js';
import { KyselyRouteRepository } from './routes/infrastructure/kysely-route-repository.js';
import type { Clock } from './shared/application/clock.js';
import type { EventBus } from './shared/application/event-bus.js';
import { KeyedMutex } from './shared/application/keyed-mutex.js';
import type { AppDatabase } from './shared/infrastructure/db/database.js';
import { InMemoryEventBus } from './shared/infrastructure/events/in-memory-event-bus.js';
import { IngestPositionService } from './tracking/application/ingest-position-service.js';
import type { TrackingEvents } from './tracking/application/tracking-events.js';
import { TripLifecycleService } from './tracking/application/trip-lifecycle-service.js';
import { DEFAULT_TRACKING_SETTINGS } from './tracking/domain/tracking-settings.js';
import { InactivityJob } from './tracking/infrastructure/inactivity-job.js';
import {
  KyselyTrackingStore,
  KyselyVehicleDirectory,
} from './tracking/infrastructure/kysely-tracking-store.js';

/** Speed profiles use this many recent completed trips of a route. */
const SPEED_PROFILE_MAX_TRIPS = 20;

export type ApiConfig = Pick<
  AppConfig,
  | 'ingestToken'
  | 'tripStartZoneMeters'
  | 'tripInactivityTimeoutSec'
  | 'tripInactivityCheckIntervalSec'
>;

export interface ApiDependencies {
  readonly config: ApiConfig;
  readonly db: AppDatabase;
  readonly clock: Clock;
  readonly logger: FastifyBaseLogger;
  /** Defaults to the logging placeholder until Web Push is wired in. */
  readonly notifier?: AlertNotifier;
}

export interface Api {
  readonly app: FastifyInstance;
  readonly events: EventBus<TrackingEvents>;
  readonly ingestPosition: IngestPositionService;
  readonly tripLifecycle: TripLifecycleService;
  readonly routes: RouteCatalog;
  readonly speedProfiles: SpeedProfileProvider;
  readonly inactivityJob: InactivityJob;
}

/**
 * Wires adapters to use cases. Used by `main.ts` and by the integration tests, so both run the
 * exact same object graph; only the database, the clock and the logger differ.
 */
export async function composeApi(deps: ApiDependencies): Promise<Api> {
  const { config, db, clock, logger } = deps;
  const events = new InMemoryEventBus<TrackingEvents>(logger);
  const vehicles = new KyselyVehicleDirectory(db);
  const store = new KyselyTrackingStore(db);
  const routes = new RouteCatalog(new KyselyRouteRepository(db));
  const speedProfiles = new SpeedProfileProvider(new KyselyCompletedTripSamples(db), {
    maxTrips: SPEED_PROFILE_MAX_TRIPS,
    bucketLengthMeters: DEFAULT_ETA_SETTINGS.bucketLengthMeters,
  });
  const mutex = new KeyedMutex();
  const tracking = {
    ...DEFAULT_TRACKING_SETTINGS,
    inactivityTimeoutSec: config.tripInactivityTimeoutSec,
  };

  const ingestPosition = new IngestPositionService({
    vehicles,
    store,
    routes,
    profiles: speedProfiles,
    notifier: deps.notifier ?? new LoggingAlertNotifier(logger.child({ component: 'alerts' })),
    events,
    clock,
    logger: logger.child({ component: 'ingest' }),
    mutex,
    settings: {
      tracking,
      eta: DEFAULT_ETA_SETTINGS,
      alerts: DEFAULT_ALERT_SETTINGS,
      startZoneMeters: config.tripStartZoneMeters,
    },
  });
  const tripLifecycle = new TripLifecycleService({
    vehicles,
    store,
    routes,
    events,
    clock,
    logger: logger.child({ component: 'trips' }),
    mutex,
    inactivityTimeoutSec: config.tripInactivityTimeoutSec,
  });
  const inactivityJob = new InactivityJob({
    closeInactiveTrips: () => tripLifecycle.closeInactiveTrips(),
    intervalMs: config.tripInactivityCheckIntervalSec * 1000,
    logger: logger.child({ component: 'inactivity-job' }),
  });

  const app = await buildApp({
    loggerInstance: logger,
    ingest: { token: config.ingestToken, ingestor: ingestPosition },
  });

  return { app, events, ingestPosition, tripLifecycle, routes, speedProfiles, inactivityJob };
}
