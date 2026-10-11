import { describe, expect, it, vi } from 'vitest';

import { RI01_REFERENCE_POINTS, RI01_ROUTE } from '../domain/ri01.fixture.js';
import { locateReferencePoints } from '../domain/reference-points.js';
import { buildRouteGeometry } from '../domain/route-geometry.js';
import { RouteCatalog, type RouteSnapshot } from './route-catalog.js';

const geometry = buildRouteGeometry(RI01_ROUTE.polyline);
const snapshot: RouteSnapshot = {
  id: 'route-1',
  code: 'RI-01',
  name: RI01_ROUTE.name,
  geometry,
  points: locateReferencePoints(geometry, RI01_REFERENCE_POINTS),
};

describe('RouteCatalog', () => {
  it('loads a route once and serves it from memory until invalidated', async () => {
    const findById = vi.fn(() => Promise.resolve(snapshot));
    const catalog = new RouteCatalog({ findById });

    await Promise.all([catalog.get('route-1'), catalog.get('route-1')]);
    expect(await catalog.get('route-1')).toBe(snapshot);
    expect(findById).toHaveBeenCalledOnce();

    catalog.invalidate('route-1');
    await catalog.get('route-1');
    expect(findById).toHaveBeenCalledTimes(2);
  });

  it('does not cache missing routes or failures', async () => {
    const findById = vi
      .fn<(id: string) => Promise<RouteSnapshot | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(snapshot);
    const catalog = new RouteCatalog({ findById });

    expect(await catalog.get('route-1')).toBeNull();
    await expect(catalog.get('route-1')).rejects.toThrow('db down');
    expect(await catalog.get('route-1')).toBe(snapshot);
  });

  it.each([
    ['resolves to null', (d: Deferred<RouteSnapshot | null>) => d.resolve(null)],
    ['fails', (d: Deferred<RouteSnapshot | null>) => d.reject(new Error('db down'))],
  ])(
    'keeps a newer cache entry when a superseded load %s',
    async (_case, settle: (d: Deferred<RouteSnapshot | null>) => void) => {
      const stale = deferred<RouteSnapshot | null>();
      const fresh = deferred<RouteSnapshot | null>();
      const findById = vi
        .fn<(id: string) => Promise<RouteSnapshot | null>>()
        .mockReturnValueOnce(stale.promise)
        .mockReturnValueOnce(fresh.promise)
        .mockResolvedValue(snapshot);
      const catalog = new RouteCatalog({ findById });

      const superseded = catalog.get('route-1').catch(() => null);
      catalog.invalidate('route-1');
      const current = catalog.get('route-1');
      settle(stale);
      await superseded;
      fresh.resolve(snapshot);
      await current;

      expect(await catalog.get('route-1')).toBe(snapshot);
      expect(findById).toHaveBeenCalledTimes(2);
    },
  );
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
