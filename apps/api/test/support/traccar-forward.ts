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
