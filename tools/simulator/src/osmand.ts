import type { PlannedFix } from './ri01-drive-plan.js';

/** The `fetch` the simulator uses; tests pass a fake. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * The OsmAnd request of one fix (Traccar's HTTP protocol, port 5055): `id`, `lat`, `lon`,
 * `timestamp` in epoch seconds, `speed` in knots, `bearing` and `accuracy` in metres.
 * See https://www.traccar.org/osmand/.
 */
export function osmAndUrl(baseUrl: string, deviceId: string, fix: PlannedFix): string {
  const url = new URL('/', baseUrl);
  url.search = new URLSearchParams({
    id: deviceId,
    lat: fix.lat.toFixed(6),
    lon: fix.lon.toFixed(6),
    timestamp: String(Math.round(fix.at.getTime() / 1000)),
    speed: fix.speedKnots.toFixed(2),
    bearing: fix.bearing.toFixed(1),
    accuracy: String(fix.accuracy),
  }).toString();
  return url.toString();
}

/** Sends one fix to Traccar's OsmAnd port; throws unless Traccar accepts it (200). */
export async function sendOsmAnd(
  baseUrl: string,
  deviceId: string,
  fix: PlannedFix,
  fetchImpl: Fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(osmAndUrl(baseUrl, deviceId, fix), { method: 'GET' });
  await response.body?.cancel();
  if (response.status === 400) {
    throw new Error(
      `Traccar answered 400 for device "${deviceId}": it does not know the device. Run bootstrap-traccar first.`,
    );
  }
  if (!response.ok) throw new Error(`Traccar answered ${response.status} to an OsmAnd fix.`);
}
