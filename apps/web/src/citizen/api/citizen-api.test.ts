import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../shared/http';
import { createCitizenApi } from './citizen-api';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('createCitizenApi', () => {
  it('reads the route catalog and the live snapshot', async () => {
    const fetchFn = vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/routes'
          ? json(200, { routes: [{ code: 'RI-01' }] })
          : json(200, { trips: [] }),
      ),
    );
    const api = createCitizenApi(fetchFn);

    expect(await api.listRoutes()).toEqual([{ code: 'RI-01' }]);
    expect(await api.getLiveSnapshot('RI-01')).toEqual({ trips: [] });
    expect(fetchFn).toHaveBeenLastCalledWith(
      '/api/live/routes/RI-01',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(api.liveStreamUrl('RI-01')).toBe('/api/live/routes/RI-01/stream');
  });

  it('cancels with the management token as a bearer token', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

    await createCitizenApi(fetchFn).cancelSubscription('sub-1', 'token-1');

    expect(fetchFn).toHaveBeenCalledWith(
      '/api/subscriptions/sub-1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ authorization: 'Bearer token-1' }) as unknown,
      }),
    );
  });

  it('throws ApiError with the error code of the answer', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(json(422, { error: 'household_route_mismatch', message: '…' })),
    );

    const failure = createCitizenApi(fetchFn).recordView({ pointCode: 'P08' });

    await expect(failure).rejects.toEqual(new ApiError(422, 'household_route_mismatch'));
    await expect(failure).rejects.toMatchObject({ status: 422, code: 'household_route_mismatch' });
  });
});
