export type RouteValidationErrorCode =
  'degenerate_route' | 'point_off_route' | 'point_order_mismatch';

/** Raised when a route or its reference points cannot be used for linear referencing. */
export class RouteValidationError extends Error {
  override readonly name = 'RouteValidationError';

  constructor(
    readonly code: RouteValidationErrorCode,
    message: string,
    readonly pointId?: string,
  ) {
    super(message);
  }
}
