/** A reference point as the public sees it: households subscribe to it, never to an address. */
export interface PublicReferencePoint {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly routeId: string;
  readonly routeCode: string;
}

/** Port: finds active reference points of active routes. */
export interface ReferencePointLookup {
  findById(pointId: string): Promise<PublicReferencePoint | null>;
  /** Points with this code (one per route at most), optionally restricted to one route code. */
  findByCode(pointCode: string, routeCode?: string): Promise<PublicReferencePoint[]>;
}
