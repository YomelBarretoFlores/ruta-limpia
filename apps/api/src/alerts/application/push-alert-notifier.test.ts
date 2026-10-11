import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemorySubscriptionStore } from '../../../test/fakes/in-memory-subscriptions.js';
import { ManualClock } from '../../../test/fakes/in-memory-tracking-store.js';
import { RI01_SNAPSHOT } from '../../../test/support/ri01-tracking.js';
import { RouteCatalog } from '../../routes/application/route-catalog.js';
import { SILENT_LOGGER } from '../../shared/application/logger.js';
import { DEFAULT_PUSH_DELIVERY_SETTINGS } from '../domain/push-delivery.js';
import type { EmittedAlert } from './alert-notifier.js';
import { PushAlertNotifier } from './push-alert-notifier.js';
import type { PushGateway } from './push-ports.js';

const NOW = new Date('2026-10-20T22:30:00Z');
const p08 = RI01_SNAPSHOT.points[7]!;
const p09 = RI01_SNAPSHOT.points[8]!;
const alert: EmittedAlert = {
  alertId: 'alert-1',
  tripId: 'trip-1',
  routeId: RI01_SNAPSHOT.id,
  pointId: p08.id,
  emittedAt: NOW,
  communicatedPredictedPassAt: new Date(NOW.getTime() + 480_000),
  secondsRemainingAtEmission: 480,
  insideTargetWindow: true,
};

function setup() {
  const store = new InMemorySubscriptionStore();
  const send = vi.fn<PushGateway['send']>(() => Promise.resolve({ httpStatus: 201 }));
  const logger = { ...SILENT_LOGGER, warn: vi.fn(), error: vi.fn() };
  const notifier = new PushAlertNotifier({
    deliveries: store,
    gateway: { send },
    routes: new RouteCatalog({ findById: () => Promise.resolve(RI01_SNAPSHOT) }),
    clock: new ManualClock(NOW),
    logger,
    settings: { ...DEFAULT_PUSH_DELIVERY_SETTINGS, concurrency: 2, maxConsecutiveFailures: 3 },
  });
  const subscribe = async (device: string, pointId = p08.id) => {
    const { id } = await store.upsert({
      endpoint: `https://fcm.googleapis.com/fcm/send/${device}`,
      p256dh: `key-${device}`,
      auth: `auth-${device}`,
      pointId,
      householdId: null,
      consentAt: NOW,
      consentVersion: '2026-10',
      managementTokenHash: 'hash',
    });
    return id;
  };
  /** The endpoints the gateway was asked to push to. */
  const pushedTo = () => send.mock.calls.map(([target]) => target.endpoint).sort();
  return { store, send, logger, notifier, subscribe, pushedTo };
}

describe('PushAlertNotifier', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('pushes once to every active subscription of the alert point', async () => {
    const a = await ctx.subscribe('a');
    await ctx.subscribe('b');
    await ctx.subscribe('other-point', p09.id);
    const revoked = await ctx.subscribe('revoked');
    await ctx.store.revoke(revoked, 'user_cancelled', NOW);

    await ctx.notifier.notify(alert);

    expect(ctx.pushedTo()).toEqual([
      'https://fcm.googleapis.com/fcm/send/a',
      'https://fcm.googleapis.com/fcm/send/b',
    ]);
    expect(ctx.store.deliveries).toHaveLength(2);
    expect(ctx.store.find(a)).toMatchObject({ lastSuccessAt: NOW, consecutiveFailures: 0 });
    expect(ctx.store.alertCounts.get('alert-1')).toEqual({
      recipients: 2,
      delivered: 2,
      failed: 0,
    });
  });

  it('sends the Spanish payload with a TTL until the pass, high urgency and a point topic', async () => {
    const id = await ctx.subscribe('a');

    await ctx.notifier.notify(alert);

    const [target, payload, options] = ctx.send.mock.calls[0]!;
    expect(target).toEqual({
      subscriptionId: id,
      endpoint: 'https://fcm.googleapis.com/fcm/send/a',
      p256dh: 'key-a',
      auth: 'auth-a',
    });
    expect(JSON.parse(payload)).toMatchObject({
      type: 'proximity_alert',
      alertId: 'alert-1',
      subscriptionId: id,
      pointCode: 'P08',
      pointName: p08.name,
      secondsRemaining: 480,
      url: '/?p=P08',
      title: 'Ruta Limpia · camión cerca',
      body: expect.stringContaining('pasará por P08 en ~8 min (aprox. 17:38)') as unknown,
    });
    expect(options).toEqual({ ttlSeconds: 480, urgency: 'high', topic: 'ruta-limpia-P08' });
  });

  it('records each outcome: sent, expired (revoked) and failed', async () => {
    const sent = await ctx.subscribe('sent');
    const gone = await ctx.subscribe('gone');
    const busy = await ctx.subscribe('busy');
    const down = await ctx.subscribe('down');
    ctx.send.mockImplementation((target) => {
      if (target.endpoint.endsWith('/gone')) return Promise.resolve({ httpStatus: 410 });
      if (target.endpoint.endsWith('/busy')) return Promise.resolve({ httpStatus: 429 });
      if (target.endpoint.endsWith('/down')) return Promise.reject(new Error('ECONNRESET'));
      return Promise.resolve({ httpStatus: 201 });
    });

    await ctx.notifier.notify(alert);

    const outcome = (id: string) => ctx.store.deliveries.find((d) => d.subscriptionId === id);
    expect(outcome(sent)).toMatchObject({ status: 'sent', httpStatus: 201, sentAt: NOW });
    expect(outcome(gone)).toMatchObject({ status: 'expired', httpStatus: 410 });
    expect(outcome(busy)).toMatchObject({ status: 'failed', httpStatus: 429 });
    expect(outcome(down)).toMatchObject({ status: 'failed', httpStatus: null });
    expect(ctx.store.find(gone)).toMatchObject({ revokedAt: NOW, revokeReason: 'expired' });
    expect(ctx.store.find(busy)).toMatchObject({ revokedAt: null, consecutiveFailures: 1 });
    expect(ctx.store.alertCounts.get('alert-1')).toEqual({
      recipients: 4,
      delivered: 1,
      failed: 3,
    });
  });

  it('revokes a subscription after too many failures in a row, and a success resets the streak', async () => {
    const id = await ctx.subscribe('flaky');
    ctx.send.mockResolvedValue({ httpStatus: 503 });
    const alertNo = (n: number): EmittedAlert => ({ ...alert, alertId: `alert-${n}` });

    await ctx.notifier.notify(alertNo(1));
    ctx.send.mockResolvedValueOnce({ httpStatus: 201 });
    await ctx.notifier.notify(alertNo(2));
    expect(ctx.store.find(id)).toMatchObject({ consecutiveFailures: 0, revokedAt: null });

    for (const n of [3, 4, 5]) await ctx.notifier.notify(alertNo(n));
    await ctx.notifier.notify(alertNo(6));

    expect(ctx.store.find(id)).toMatchObject({ revokeReason: 'too_many_failures' });
    expect(ctx.send).toHaveBeenCalledTimes(5);
  });

  it('keeps delivering to the others when recording one outcome fails', async () => {
    await ctx.subscribe('a');
    await ctx.subscribe('b');
    vi.spyOn(ctx.store, 'markSuccess').mockRejectedValueOnce(new Error('db down'));

    await ctx.notifier.notify(alert);

    expect(ctx.send).toHaveBeenCalledTimes(2);
    expect(ctx.store.deliveries).toHaveLength(2);
    expect(ctx.logger.error).toHaveBeenCalledOnce();
  });

  it('sends nothing when the alert point is unknown', async () => {
    await ctx.subscribe('a');

    await ctx.notifier.notify({ ...alert, pointId: 'missing-point' });

    expect(ctx.send).not.toHaveBeenCalled();
    expect(ctx.logger.error).toHaveBeenCalledOnce();
  });
});
