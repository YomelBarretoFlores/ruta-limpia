import type { RouteGeometry } from '../domain/route-geometry.js';
import type { LocatedReferencePoint } from '../domain/route.js';

/**
 * A route ready for tracking: its prepared geometry and its active reference points (located,
 * in route order). Structurally a tracking `TrackedRoute`.
 */
export interface RouteSnapshot {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly geometry: RouteGeometry;
  readonly points: readonly LocatedReferencePoint[];
}

/** Port: loads routes from storage. */
export interface RouteRepository {
  findById(routeId: string): Promise<RouteSnapshot | null>;
}

/**
 * Read-through, in-memory cache of route snapshots. Routes change rarely (catalog edits), and
 * preparing the geometry on every fix would be wasteful. Call `invalidate` after a catalog edit.
 */
export class RouteCatalog {
  private readonly cache = new Map<string, Promise<RouteSnapshot | null>>();

  constructor(private readonly repository: RouteRepository) {}

  async get(routeId: string): Promise<RouteSnapshot | null> {
    let entry = this.cache.get(routeId);
    if (entry === undefined) {
      entry = this.repository.findById(routeId);
      this.cache.set(routeId, entry);
    }
    try {
      const route = await entry;
      if (route === null) this.cache.delete(routeId); // a route may be created later
      return route;
    } catch (error) {
      this.cache.delete(routeId);
      throw error;
    }
  }

  invalidate(routeId?: string): void {
    if (routeId === undefined) this.cache.clear();
    else this.cache.delete(routeId);
  }
}
