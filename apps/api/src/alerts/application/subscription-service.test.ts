import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManualClock } from '../../../test/fakes/in-memory-tracking-store.js';
import {
  FakeManagementTokens,
  InMemoryHouseholds,
  InMemoryReferencePoints,
  InMemorySubscriptionStore,
} from '../../../test/fakes/in-memory-subscriptions.js';
import type { PublicReferencePoint } from '../../routes/application/reference-point-lookup.js';
import { SILENT_LOGGER } from '../../shared/application/logger.js';
import { SubscriptionService, type SubscribeCommand } from './subscription-service.js';

const NOW = new Date('2026-10-20T12:00:00Z');
const p08: PublicReferencePoint = {
  id: 'point-p08',
  code: 'P08',
  name: 'Mercado',
  routeId: 'route-ri-01',
  routeCode: 'RI-01',
};
const p09: PublicReferencePoint = { ...p08, id: 'point-p09', code: 'P09', name: 'Plaza' };
const huarazP08: PublicReferencePoint = {
  ...p08,
  id: 'point-h-p08',
  routeId: 'route-rh-01',
  routeCode: 'RH-01',
};
const endpoint = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
  p256dh: 'BPublicKey',
  auth: 'authSecret',
};
const command = (overrides: Partial<SubscribeCommand> = {}): SubscribeCommand => ({
  subscription: endpoint,
  point: { pointCode: 'p09' },
  householdCode: null,
  consentVersion: '2026-10',
  ...overrides,
});

function setup() {
  const store = new InMemorySubscriptionStore();
  const clock = new ManualClock(NOW);
  const service = new SubscriptionService({
    store,
    points: new InMemoryReferencePoints([p08, p09, huarazP08]),
    households: new InMemoryHouseholds([
      { id: 'household-1', code: 'H-001', routeId: p08.routeId, pointId: p08.id, active: true },
      { id: 'household-2', code: 'H-002', routeId: p08.routeId, pointId: p08.id, active: false },
    ]),
    tokens: new FakeManagementTokens(),
    clock,
    logger: SILENT_LOGGER,
  });
  return { store, clock, service };
}

describe('SubscriptionService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('subscribes to a point by code and stores only the token hash and the consent', async () => {
    const result = await ctx.service.subscribe(command({ householdCode: ' h-001 ' }));

    expect(result).toEqual({
      status: 'subscribed',
      subscriptionId: 'subscription-1',
      managementToken: 'token-1',
      point: p09,
    });
    expect(ctx.store.subscriptions).toEqual([
      expect.objectContaining({
        ...endpoint,
        pointId: p09.id,
        householdId: 'household-1',
        consentAt: NOW,
        consentVersion: '2026-10',
        managementTokenHash: 'hash:token-1',
      }),
    ]);
    expect(JSON.stringify(ctx.store.subscriptions)).not.toContain('"token-1"');
  });

  it('subscribes by point id', async () => {
    const result = await ctx.service.subscribe(command({ point: { pointId: p08.id } }));

    expect(result).toMatchObject({ status: 'subscribed', point: p08 });
  });

  it('needs the route code when the point code exists on several routes', async () => {
    const ambiguous = await ctx.service.subscribe(command({ point: { pointCode: 'P08' } }));
    const resolved = await ctx.service.subscribe(
      command({ point: { pointCode: 'P08', routeCode: 'rh-01' } }),
    );

    expect(ambiguous).toEqual({ status: 'ambiguous_point' });
    expect(resolved).toMatchObject({ status: 'subscribed', point: huarazP08 });
  });

  it.each([
    ['an unknown point', command({ point: { pointCode: 'P99' } }), 'unknown_point'],
    ['an unknown household', command({ householdCode: 'H-404' }), 'unknown_household'],
    ['an inactive household', command({ householdCode: 'H-002' }), 'unknown_household'],
    [
      'a non push-service endpoint',
      command({ subscription: { ...endpoint, endpoint: 'https://intranet.local/hook' } }),
      'unsupported_push_service',
    ],
  ])('rejects %s without storing anything', async (_case, input, status) => {
    expect(await ctx.service.subscribe(input)).toEqual({ status });
    expect(ctx.store.subscriptions).toEqual([]);
  });

  it('updates the point and rotates the token when the same endpoint subscribes again', async () => {
    const first = await ctx.service.subscribe(command());
    await ctx.service.cancel('subscription-1', 'token-1');
    const second = await ctx.service.subscribe(command({ point: { pointId: p08.id } }));

    expect(second).toMatchObject({
      status: 'subscribed',
      subscriptionId: 'subscription-1',
      managementToken: 'token-2',
    });
    expect(ctx.store.subscriptions).toHaveLength(1);
    expect(ctx.store.find('subscription-1')).toMatchObject({
      pointId: p08.id,
      managementTokenHash: 'hash:token-2',
      revokedAt: null,
    });
    expect(first.status).toBe('subscribed');
    expect(await ctx.service.cancel('subscription-1', 'token-1')).toBe('forbidden');
  });

  it('cancels with the management token, idempotently', async () => {
    await ctx.service.subscribe(command());

    expect(await ctx.service.cancel('subscription-1', 'token-1')).toBe('cancelled');
    expect(await ctx.service.cancel('subscription-1', 'token-1')).toBe('cancelled');
    expect(ctx.store.find('subscription-1')).toMatchObject({
      revokedAt: NOW,
      revokeReason: 'user_cancelled',
    });
  });

  it('refuses to cancel with a wrong token or an unknown id', async () => {
    await ctx.service.subscribe(command());

    expect(await ctx.service.cancel('subscription-1', 'token-9')).toBe('forbidden');
    expect(await ctx.service.cancel('subscription-9', 'token-1')).toBe('not_found');
    expect(ctx.store.find('subscription-1')?.revokedAt).toBeNull();
  });

  it('never lets an old token revoke a subscription that was re-subscribed meanwhile', async () => {
    await ctx.service.subscribe(command());
    const findManaged = ctx.store.findManaged.bind(ctx.store);
    // The same browser subscribes again between the token check and the revocation.
    vi.spyOn(ctx.store, 'findManaged').mockImplementationOnce(async (id) => {
      const found = await findManaged(id);
      await ctx.service.subscribe(command({ point: { pointId: p08.id } }));
      return found;
    });

    expect(await ctx.service.cancel('subscription-1', 'token-1')).toBe('forbidden');
    expect(ctx.store.find('subscription-1')).toMatchObject({
      pointId: p08.id,
      managementTokenHash: 'hash:token-2',
      revokedAt: null,
    });
  });

  it("rejects a household whose route is not the point's route", async () => {
    const result = await ctx.service.subscribe(
      command({ point: { pointCode: 'P08', routeCode: 'RH-01' }, householdCode: 'H-001' }),
    );

    expect(result).toEqual({ status: 'household_route_mismatch' });
    expect(ctx.store.subscriptions).toEqual([]);
  });

  it('allows a household to follow another point of its own route', async () => {
    // H-001 is enrolled at P08; following P09 on the same route (for example a closer point on
    // the way to work) is allowed.
    const result = await ctx.service.subscribe(command({ householdCode: 'H-001' }));

    expect(result).toMatchObject({ status: 'subscribed', point: p09 });
  });

  it('confirms the reception of a delivered alert once, with the management token', async () => {
    await ctx.service.subscribe(command());
    await ctx.store.recordDelivery({
      alertId: 'alert-1',
      subscriptionId: 'subscription-1',
      status: 'sent',
      httpStatus: 201,
      sentAt: NOW,
    });
    const later = new Date(NOW.getTime() + 5_000);

    expect(await ctx.service.confirmReceipt('alert-1', 'subscription-1', 'token-1')).toBe(
      'confirmed',
    );
    ctx.clock.set(later);
    expect(await ctx.service.confirmReceipt('alert-1', 'subscription-1', 'token-1')).toBe(
      'confirmed',
    );
    expect(ctx.store.deliveries[0]?.receivedAt).toEqual(NOW);
  });

  it('refuses receipts with a wrong token or without a matching delivery', async () => {
    await ctx.service.subscribe(command());

    expect(await ctx.service.confirmReceipt('alert-1', 'subscription-1', 'token-9')).toBe(
      'forbidden',
    );
    expect(await ctx.service.confirmReceipt('alert-1', 'subscription-1', 'token-1')).toBe(
      'not_found',
    );
    expect(await ctx.service.confirmReceipt('alert-1', 'subscription-9', 'token-1')).toBe(
      'not_found',
    );
  });
});
