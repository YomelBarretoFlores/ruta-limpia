/** The simulator as a library, for the end-to-end smoke test. */
export { osmAndUrl, sendOsmAnd, type Fetch } from './osmand.js';
export {
  KNOTS_PER_MPS,
  planRi01Drive,
  RI01_LENGTH_METERS,
  RI01_STOPS,
  type DrivePlan,
  type DrivePlanOptions,
  type PlannedFix,
} from './ri01-drive-plan.js';
export {
  bootstrapTraccar,
  type TraccarBootstrapOptions,
  type TraccarBootstrapResult,
} from './traccar-admin.js';
