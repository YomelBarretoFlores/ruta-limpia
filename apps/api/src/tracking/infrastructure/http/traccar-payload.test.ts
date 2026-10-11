import { describe, expect, it } from 'vitest';

import { sampleForward } from '../../../../test/support/traccar-forward.js';
import { toIngestCommand, traccarForwardSchema } from './traccar-payload.js';

describe('traccarForwardSchema', () => {
  it('maps a Traccar forward to an ingest command, converting knots to km/h', () => {
    const command = toIngestCommand(traccarForwardSchema.parse(sampleForward));

    expect(command).toEqual({
      traccarPositionId: 1234,
      deviceUniqueId: 'ruta-limpia-unidad-a',
      fixTime: new Date('2026-10-20T12:00:00Z'),
      serverTime: new Date('2026-10-20T12:00:05Z'),
      lat: -9.523207,
      lon: -77.528621,
      speedKmh: expect.closeTo(10.0008, 4) as number,
      course: 340,
      valid: true,
      accuracy: 8,
    });
  });

  it('accepts a position not stored by Traccar yet (id 0), without a Traccar id', () => {
    const payload = { ...sampleForward, position: { ...sampleForward.position, id: 0 } };

    expect(toIngestCommand(traccarForwardSchema.parse(payload)).traccarPositionId).toBeNull();
  });

  it('accepts epoch-millisecond dates and missing optional fields', () => {
    const position: Record<string, unknown> = { ...sampleForward.position };
    delete position['serverTime'];
    delete position['course'];
    delete position['accuracy'];
    const payload = { ...sampleForward, position: { ...position, fixTime: Date.UTC(2026, 9, 20) } };

    const command = toIngestCommand(traccarForwardSchema.parse(payload));

    expect(command.fixTime).toEqual(new Date(Date.UTC(2026, 9, 20)));
    expect(command).toMatchObject({ serverTime: null, course: null, accuracy: null });
  });

  it.each([
    ['a missing device', { position: sampleForward.position }],
    [
      'an invalid date',
      { ...sampleForward, position: { ...sampleForward.position, fixTime: 'yesterday' } },
    ],
    [
      'a latitude out of range',
      { ...sampleForward, position: { ...sampleForward.position, latitude: 91 } },
    ],
    [
      'a negative position id',
      { ...sampleForward, position: { ...sampleForward.position, id: -1 } },
    ],
    ['an empty device uniqueId', { ...sampleForward, device: { uniqueId: '' } }],
  ])('rejects %s', (_label, payload) => {
    expect(traccarForwardSchema.safeParse(payload).success).toBe(false);
  });
});
