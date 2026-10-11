/** A reference point resolved from its public code, with what the field instruments need. */
export interface ResolvedPoint {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** The operators observe the truck's music notice at this point (Instrument 2). */
  readonly observesMusic: boolean;
}

export type RoutePointResolution =
  | {
      readonly status: 'ok';
      readonly routeId: string;
      readonly routeCode: string;
      /** Null when no point code was asked for. */
      readonly point: ResolvedPoint | null;
    }
  | { readonly status: 'unknown_route' | 'unknown_point' };

/** Port: resolves the public route and point codes the panel sends (active ones only). */
export interface RoutePointResolver {
  resolve(routeCode: string, pointCode?: string): Promise<RoutePointResolution>;
}
