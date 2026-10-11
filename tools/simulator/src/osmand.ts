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

/** How long to wait for Traccar's answer to one fix before giving up. */
export const OSMAND_TIMEOUT_MS = 10_000;

/** Sends one fix to Traccar's OsmAnd port; throws unless Traccar accepts it (200) in time. */
export async function sendOsmAnd(
  baseUrl: string,
  deviceId: string,
  fix: PlannedFix,
  fetchImpl: Fetch = fetch,
  timeoutMs = OSMAND_TIMEOUT_MS,
): Promise<void> {
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(osmAndUrl(baseUrl, deviceId, fix), { method: 'GET', signal });
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`Traccar did not answer an OsmAnd fix within ${timeoutMs} ms.`, {
        cause: error,
      });
    }
    throw error;
  }
  await response.body?.cancel();
  if (response.status === 400) {
    throw new Error(
      `Traccar answered 400 for device "${deviceId}": it does not know the device. Run bootstrap-traccar first.`,
    );
  }
  if (!response.ok) throw new Error(`Traccar answered ${response.status} to an OsmAnd fix.`);
}
