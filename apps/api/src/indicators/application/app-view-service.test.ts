import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManualClock } from '../../../test/fakes/in-memory-tracking-store.js';
import { InMemoryReferencePoints } from '../../../test/fakes/in-memory-subscriptions.js';
import type { PublicReferencePoint } from '../../routes/application/reference-point-lookup.js';
import { SILENT_LOGGER } from '../../shared/application/logger.js';
import {
  AppViewService,
  type NewAppView,
  type SubscriberIdentification,
} from './app-view-service.js';

const NOW = new Date('2026-10-20T12:00:00Z');
const p08: PublicReferencePoint = {
  id: 'point-p08',
  code: 'P08',
  name: 'Mercado',
  routeId: 'route-ri-01',
  routeCode: 'RI-01',
};
const huarazP08: PublicReferencePoint = {
  ...p08,
  id: 'point-h-p08',
  routeId: 'route-rh-01',
  routeCode: 'RH-01',
};
const p09: PublicReferencePoint = { ...p08, id: 'point-p09', code: 'P09' };

function setup() {
  const views: NewAppView[] = [];
  const identify = vi.fn<SubscriberIdentification['identify']>((id, token) =>
    Promise.resolve(
      id === 'subscription-1' && token === 'token-1'
        ? { subscriptionId: id, householdId: 'household-1' }
        : null,
    ),
  );
  const service = new AppViewService({
    points: new InMemoryReferencePoints([p08, huarazP08, p09]),
    subscribers: { identify },
    store: {
      record: (view) => {
        views.push(view);
        return Promise.resolve();
      },
    },
    clock: new ManualClock(NOW),
    logger: SILENT_LOGGER,
  });
  return { views, identify, service };
}

describe('AppViewService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('records an anonymous view of a point', async () => {
    expect(await ctx.service.record({ pointCode: ' p09 ' })).toBe('recorded');

    expect(ctx.views).toEqual([
      { pointId: p09.id, subscriptionId: null, householdId: null, viewedAt: NOW },
    ]);
    expect(ctx.identify).not.toHaveBeenCalled();
  });

  it('links the view to the subscription and its household with a valid token', async () => {
    await ctx.service.record({
      pointCode: 'P09',
      subscriptionId: 'subscription-1',
      managementToken: 'token-1',
    });

    expect(ctx.views).toEqual([
      {
        pointId: p09.id,
        subscriptionId: 'subscription-1',
        householdId: 'household-1',
        viewedAt: NOW,
      },
    ]);
  });

  it.each([
    ['a wrong token', { subscriptionId: 'subscription-1', managementToken: 'token-9' }],
    ['an unknown subscription', { subscriptionId: 'subscription-9', managementToken: 'token-1' }],
    ['no token', { subscriptionId: 'subscription-1' }],
  ])('records an anonymous view with %s, without telling', async (_case, credentials) => {
    expect(await ctx.service.record({ pointCode: 'P09', ...credentials })).toBe('recorded');

    expect(ctx.views).toEqual([
      { pointId: p09.id, subscriptionId: null, householdId: null, viewedAt: NOW },
    ]);
  });

  it('needs the route code when the point code repeats across routes', async () => {
    expect(await ctx.service.record({ pointCode: 'P08' })).toBe('ambiguous_point');
    expect(await ctx.service.record({ pointCode: 'P08', routeCode: 'rh-01' })).toBe('recorded');
    expect(await ctx.service.record({ pointCode: 'P99' })).toBe('unknown_point');

    expect(ctx.views.map((v) => v.pointId)).toEqual([huarazP08.id]);
  });
});
