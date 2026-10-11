import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

import { LoggingAlertNotifier } from './alerts/infrastructure/logging-alert-notifier.js';
import { DEFAULT_ALERT_SETTINGS } from './alerts/domain/alert-policy.js';
import { SubscriptionService } from './alerts/application/subscription-service.js';
import { CryptoManagementTokens } from './alerts/infrastructure/crypto-management-tokens.js';
import { KyselySubscriptionStore } from './alerts/infrastructure/kysely-subscription-store.js';
import { buildApp, type PanelRouteRegistration } from './app.js';
import type { PasswordHasher } from './auth/application/auth-ports.js';
import { AuthService } from './auth/application/auth-service.js';
import { UserAdminService } from './auth/application/user-admin-service.js';
import { CryptoSessionTokens } from './auth/infrastructure/crypto-session-tokens.js';
import { KyselySessionStore, KyselyUserStore } from './auth/infrastructure/kysely-auth-stores.js';
import { ScryptPasswordHasher } from './auth/infrastructure/scrypt-password-hasher.js';
import { KyselyHouseholdDirectory } from './field/infrastructure/kysely-household-directory.js';
import type { AppConfig } from './config.js';
import type { AlertNotifier } from './alerts/application/alert-notifier.js';
import { PushAlertNotifier } from './alerts/application/push-alert-notifier.js';
import type { PushGateway } from './alerts/application/push-ports.js';
import { DEFAULT_PUSH_DELIVERY_SETTINGS } from './alerts/domain/push-delivery.js';
import { KyselyAlertDeliveryStore } from './alerts/infrastructure/kysely-alert-delivery-store.js';
import { WebPushGateway } from './alerts/infrastructure/web-push-gateway.js';
import { SpeedProfileProvider } from './eta/application/speed-profile-provider.js';
import { DEFAULT_ETA_SETTINGS } from './eta/domain/eta-settings.js';
import { KyselyCompletedTripSamples } from './eta/infrastructure/kysely-completed-trip-samples.js';
import { AppViewService } from './indicators/application/app-view-service.js';
import { KyselyAppViewStore } from './indicators/infrastructure/kysely-app-view-store.js';
import { LiveSnapshotService } from './live/application/live-snapshot-service.js';
import { KyselyLiveRouteReadModel } from './live/infrastructure/kysely-live-read-model.js';
import { LiveStreamHub } from './live/infrastructure/sse/live-stream-hub.js';
import { RouteCatalog } from './routes/application/route-catalog.js';
import { KyselyPublicRouteQueries } from './routes/infrastructure/kysely-public-route-queries.js';
import { KyselyReferencePointLookup } from './routes/infrastructure/kysely-reference-point-lookup.js';
import { KyselyRouteRepository } from './routes/infrastructure/kysely-route-repository.js';
import type { Clock } from './shared/application/clock.js';
import type { EventBus } from './shared/application/event-bus.js';
import { KeyedMutex } from './shared/application/keyed-mutex.js';
import type { AppDatabase } from './shared/infrastructure/db/database.js';
import { InMemoryEventBus } from './shared/infrastructure/events/in-memory-event-bus.js';
import { KyselyAuditLog } from './shared/infrastructure/audit/kysely-audit-log.js';
import { IngestPositionService } from './tracking/application/ingest-position-service.js';
import type { TrackingEvents } from './tracking/application/tracking-events.js';
import { TripLifecycleService } from './tracking/application/trip-lifecycle-service.js';
import { DEFAULT_TRACKING_SETTINGS } from './tracking/domain/tracking-settings.js';
import { EtaRefreshService } from './tracking/application/eta-refresh-service.js';
import { EtaRefreshJob } from './tracking/infrastructure/eta-refresh-job.js';
import { InactivityJob } from './tracking/infrastructure/inactivity-job.js';
import { PanelTripService } from './tracking/application/panel-trip-service.js';
import { IncidentService } from './field/application/incident-service.js';
import { panelIncidentRoutes } from './field/infrastructure/http/panel-incident-routes.js';
import { KyselyIncidentStore } from './field/infrastructure/kysely-incident-store.js';
import { PanelLiveService } from './live/application/panel-live-service.js';
import { panelLiveRoutes } from './live/infrastructure/http/panel-live-routes.js';
import { KyselyPanelLiveReadModel } from './live/infrastructure/kysely-panel-live-read-model.js';
import { KyselyRoutePointResolver } from './routes/infrastructure/kysely-route-point-resolver.js';
import { panelTripRoutes } from './tracking/infrastructure/http/panel-trip-routes.js';
import { KyselyTripHistoryQueries } from './tracking/infrastructure/kysely-trip-history.js';
import {
  KyselyTrackingStore,
  KyselyTripReader,
  KyselyVehicleDirectory,
} from './tracking/infrastructure/kysely-tracking-store.js';

/** Speed profiles use this many recent completed trips of a route. */
const SPEED_PROFILE_MAX_TRIPS = 20;
/** Live streams send a heartbeat comment this often, below common proxy idle timeouts (60 s). */
const SSE_HEARTBEAT_MS = 15_000;
/** `EventSource` reconnects this long after a dropped stream. */
const SSE_RETRY_MS = 5_000;
/** A panel session's last-seen time is written at most this often. */
const SESSION_TOUCH_INTERVAL_SEC = 60;

export type ApiConfig = Pick<
  AppConfig,
  | 'ingestToken'
  | 'tripStartZoneMeters'
  | 'tripInactivityTimeoutSec'
  | 'tripInactivityCheckIntervalSec'
  | 'etaRefreshIntervalSec'
  | 'sseMaxConnections'
  | 'maxFixFutureSkewSec'
  | 'trustProxy'
  | 'publicRateLimitPerMinute'
  | 'sessionCookieSecure'
  | 'sessionIdleMinutes'
  | 'sessionAbsoluteHours'
  | 'loginRateLimitPerMinute'
  | 'publicOrigin'
  | 'vapid'
  | 'pushConcurrency'
  | 'pushMaxConsecutiveFailures'
>;

export interface ApiDependencies {
  readonly config: ApiConfig;
  readonly db: AppDatabase;
  readonly clock: Clock;
  readonly logger: FastifyBaseLogger;
  /** Replaces the whole alert delivery (tests). */
  readonly notifier?: AlertNotifier;
  /**
   * Replaces the Web Push client (tests). Defaults to `web-push` when VAPID is configured; without
   * VAPID and without a gateway, alerts are only logged.
   */
  readonly pushGateway?: PushGateway;
  /** Replaces the scrypt password hasher (tests use cheaper parameters). */
  readonly passwordHasher?: PasswordHasher;
}

export interface Api {
  readonly app: FastifyInstance;
  readonly events: EventBus<TrackingEvents>;
  readonly ingestPosition: IngestPositionService;
  readonly tripLifecycle: TripLifecycleService;
  readonly routes: RouteCatalog;
  readonly speedProfiles: SpeedProfileProvider;
  readonly inactivityJob: InactivityJob;
  readonly etaRefresh: EtaRefreshService;
  readonly etaRefreshJob: EtaRefreshJob;
  readonly subscriptions: SubscriptionService;
  readonly liveSnapshots: LiveSnapshotService;
  readonly liveStreams: LiveStreamHub;
  readonly appViews: AppViewService;
  readonly auth: AuthService;
  readonly userAdmin: UserAdminService;
  readonly audit: KyselyAuditLog;
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

  const pushGateway =
    deps.pushGateway ?? (config.vapid === null ? null : new WebPushGateway(config.vapid));
  const notifier =
    deps.notifier ??
    (pushGateway === null
      ? new LoggingAlertNotifier(logger.child({ component: 'alerts' }))
      : new PushAlertNotifier({
          deliveries: new KyselyAlertDeliveryStore(db),
          gateway: pushGateway,
          routes,
          clock,
          logger: logger.child({ component: 'push' }),
          settings: {
            ...DEFAULT_PUSH_DELIVERY_SETTINGS,
            concurrency: config.pushConcurrency,
            maxConsecutiveFailures: config.pushMaxConsecutiveFailures,
          },
        }));

  const ingestPosition = new IngestPositionService({
    vehicles,
    store,
    routes,
    profiles: speedProfiles,
    notifier,
    events,
    clock,
    logger: logger.child({ component: 'ingest' }),
    mutex,
    settings: {
      tracking,
      eta: DEFAULT_ETA_SETTINGS,
      alerts: DEFAULT_ALERT_SETTINGS,
      startZoneMeters: config.tripStartZoneMeters,
      maxFixFutureSkewSec: config.maxFixFutureSkewSec,
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

  const etaRefresh = new EtaRefreshService({
    trips: new KyselyTripReader(db),
    routes,
    profiles: speedProfiles,
    events,
    clock,
    logger: logger.child({ component: 'eta-refresh' }),
    mutex,
    settings: DEFAULT_ETA_SETTINGS,
  });
  const etaRefreshJob = new EtaRefreshJob({
    refreshAll: () => etaRefresh.refreshAll(),
    intervalMs: config.etaRefreshIntervalSec * 1000,
    logger: logger.child({ component: 'eta-refresh-job' }),
  });

  const referencePoints = new KyselyReferencePointLookup(db);
  const subscriptions = new SubscriptionService({
    store: new KyselySubscriptionStore(db),
    points: referencePoints,
    households: new KyselyHouseholdDirectory(db),
    tokens: new CryptoManagementTokens(),
    clock,
    logger: logger.child({ component: 'subscriptions' }),
  });
  if (config.vapid === null) {
    logger.warn(
      'Web Push is not configured (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT): ' +
        'subscriptions are disabled and alerts are only logged',
    );
  }

  const routeQueries = new KyselyPublicRouteQueries(db);
  const liveSnapshots = new LiveSnapshotService({
    routeIds: routeQueries,
    routes,
    readModel: new KyselyLiveRouteReadModel(db),
    profiles: speedProfiles,
    clock,
    logger: logger.child({ component: 'live' }),
    etaSettings: DEFAULT_ETA_SETTINGS,
  });

  const liveStreams = new LiveStreamHub({
    events,
    maxConnections: config.sseMaxConnections,
    heartbeatMs: SSE_HEARTBEAT_MS,
    retryMs: SSE_RETRY_MS,
    logger: logger.child({ component: 'live-stream' }),
  });

  const appViews = new AppViewService({
    points: referencePoints,
    subscribers: subscriptions,
    store: new KyselyAppViewStore(db),
    clock,
    logger: logger.child({ component: 'usage' }),
  });

  const audit = new KyselyAuditLog(db);
  const users = new KyselyUserStore(db);
  const sessions = new KyselySessionStore(db);
  const hasher = deps.passwordHasher ?? new ScryptPasswordHasher();
  const auth = new AuthService({
    users,
    sessions,
    hasher,
    tokens: new CryptoSessionTokens(),
    audit,
    clock,
    logger: logger.child({ component: 'auth' }),
    sessionPolicy: {
      idleMinutes: config.sessionIdleMinutes,
      absoluteHours: config.sessionAbsoluteHours,
      touchIntervalSec: SESSION_TOUCH_INTERVAL_SEC,
    },
  });
  const userAdmin = new UserAdminService({ users, sessions, hasher, audit, clock });
  if (!config.sessionCookieSecure) {
    logger.warn('SESSION_COOKIE_SECURE=false: panel session cookies travel over plain HTTP');
  }
  const panelRoutes: PanelRouteRegistration[] = [];

  const panelTrips = new PanelTripService({
    queries: new KyselyTripHistoryQueries(db),
    lifecycle: tripLifecycle,
    audit,
    clock,
    maxFixAgeSec: DEFAULT_ETA_SETTINGS.maxFixAgeSec,
  });
  panelRoutes.push((scope) => scope.register(panelTripRoutes, { trips: panelTrips }));

  const routePoints = new KyselyRoutePointResolver(db);
  const incidents = new IncidentService({
    store: new KyselyIncidentStore(db),
    points: routePoints,
    audit,
    clock,
  });
  panelRoutes.push((scope) => scope.register(panelIncidentRoutes, { incidents }));

  const panelLive = new PanelLiveService({
    snapshots: liveSnapshots,
    readModel: new KyselyPanelLiveReadModel(db),
  });
  panelRoutes.push((scope) => scope.register(panelLiveRoutes, { live: panelLive }));

  const app = await buildApp({
    loggerInstance: logger,
    trustProxy: config.trustProxy,
    ingest: { token: config.ingestToken, ingestor: ingestPosition },
    publicApi: {
      subscriptions,
      vapidPublicKey: config.vapid?.publicKey ?? null,
      mutationsPerMinute: config.publicRateLimitPerMinute,
    },
    publicRead: {
      catalog: { queries: routeQueries },
      live: {
        snapshots: liveSnapshots,
        stream: { hub: liveStreams, maxFixAgeSec: DEFAULT_ETA_SETTINGS.maxFixAgeSec },
      },
    },
    usage: { views: appViews, mutationsPerMinute: config.publicRateLimitPerMinute },
    panel: {
      guard: {
        sessions: auth,
        cookieSecure: config.sessionCookieSecure,
        publicOrigin: config.publicOrigin,
      },
      auth: {
        auth,
        cookieSecure: config.sessionCookieSecure,
        loginPerMinute: config.loginRateLimitPerMinute,
      },
      users: { users: userAdmin, audit },
      routes: panelRoutes,
    },
  });

  return {
    app,
    events,
    ingestPosition,
    tripLifecycle,
    routes,
    speedProfiles,
    inactivityJob,
    etaRefresh,
    etaRefreshJob,
    subscriptions,
    liveSnapshots,
    liveStreams,
    appViews,
    auth,
    userAdmin,
    audit,
  };
}
