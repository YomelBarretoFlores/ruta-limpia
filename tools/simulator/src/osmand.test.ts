import { describe, expect, it } from 'vitest';

import { osmAndUrl, sendOsmAnd } from './osmand.js';
import type { PlannedFix } from './ri01-drive-plan.js';

const FIX: PlannedFix = {
  offsetSec: 40,
  at: new Date('2026-10-20T12:05:40Z'),
  lat: -9.5232071234,
  lon: -77.5286219876,
  speedKnots: 6.80345,
  bearing: 345.678,
  accuracy: 5,
  chainage: 140,
};

describe('osmAndUrl', () => {
  it('carries the device, the position, the time in epoch seconds and the speed in knots', () => {
    const url = new URL(osmAndUrl('http://127.0.0.1:5055', 'ruta-limpia-unidad-a', FIX));

    expect(url.origin).toBe('http://127.0.0.1:5055');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      id: 'ruta-limpia-unidad-a',
      lat: '-9.523207',
      lon: '-77.528622',
      timestamp: String(Date.parse('2026-10-20T12:05:40Z') / 1000),
      speed: '6.80',
      bearing: '345.7',
      accuracy: '5',
    });
  });
});

describe('sendOsmAnd', () => {
  it('sends a GET and accepts a 200', async () => {
    const calls: string[] = [];
    await sendOsmAnd('http://traccar:5055/', 'dev-1', FIX, (input) => {
      calls.push(String(input));
      return Promise.resolve(new Response('', { status: 200 }));
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^http:\/\/traccar:5055\/\?id=dev-1&/);
  });

  it('explains a 400: Traccar does not know the device yet', async () => {
    const refuse = () => Promise.resolve(new Response('', { status: 400 }));

    await expect(sendOsmAnd('http://traccar:5055', 'dev-1', FIX, refuse)).rejects.toThrow(
      /400.*bootstrap-traccar/,
    );
  });
});
