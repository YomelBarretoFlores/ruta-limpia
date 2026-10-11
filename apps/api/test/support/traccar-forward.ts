import { ri01PositionAt, stopAndGoChainageAt } from './ri01-tracking.js';

/**
 * A Traccar 6 JSON position forward (OsmAnd device), with the extra fields Traccar sends.
 * Speed is in knots.
 */
export const sampleForward = {
  position: {
    id: 1234,
    attributes: { batteryLevel: 87, distance: 12.3, motion: true },
    deviceId: 1,
    protocol: 'osmand',
    serverTime: '2026-10-20T12:00:05.000+00:00',
    deviceTime: '2026-10-20T12:00:00.000+00:00',
    fixTime: '2026-10-20T12:00:00.000+00:00',
    outdated: false,
    valid: true,
    latitude: -9.523207,
    longitude: -77.528621,
    altitude: 3050,
    speed: 5.4,
    course: 340,
    address: null,
    accuracy: 8,
    network: null,
  },
  device: {
    id: 1,
    attributes: {},
    groupId: 0,
    name: 'Unidad A',
    uniqueId: 'ruta-limpia-unidad-a',
    status: 'online',
    lastUpdate: '2026-10-20T12:00:05.000+00:00',
    positionId: 1233,
    disabled: false,
  },
};

const KNOTS_PER_MPS = 3600 / 1852;

/**
 * The forward of Traccar position `id`, `seconds` after `t0`, at `chainage` along RI-01, with the
 * stop-and-go speed (1.5 m/s while moving).
 */
export function forwardAt(
  t0: number,
  id: number,
  seconds: number,
  chainage: number,
  uniqueId = sampleForward.device.uniqueId,
) {
  const at = new Date(t0 + seconds * 1000).toISOString();
  const position = ri01PositionAt(chainage);
  const moving = stopAndGoChainageAt(seconds + 1) > stopAndGoChainageAt(seconds);
  return {
    position: {
      ...sampleForward.position,
      id,
      fixTime: at,
      deviceTime: at,
      serverTime: at,
      latitude: position.lat,
      longitude: position.lon,
      speed: moving ? 1.5 * KNOTS_PER_MPS : 0,
    },
    device: { ...sampleForward.device, uniqueId },
  };
}
