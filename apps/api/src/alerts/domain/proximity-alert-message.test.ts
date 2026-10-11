import { describe, expect, it } from 'vitest';

import { buildProximityAlertMessage } from './proximity-alert-message.js';

const input = {
  alertId: 'alert-1',
  subscriptionId: 'subscription-1',
  pointCode: 'P08',
  pointName: 'Mercado Central',
  // 17:38 in Lima (UTC-5).
  predictedPassAt: new Date('2026-10-20T22:38:00Z'),
  now: new Date('2026-10-20T22:30:00Z'),
};

describe('buildProximityAlertMessage', () => {
  it('builds the Spanish notification with the time in America/Lima', () => {
    expect(buildProximityAlertMessage(input)).toEqual({
      type: 'proximity_alert',
      alertId: 'alert-1',
      subscriptionId: 'subscription-1',
      pointCode: 'P08',
      pointName: 'Mercado Central',
      predictedPassAt: '2026-10-20T22:38:00.000Z',
      secondsRemaining: 480,
      url: '/?p=P08',
      title: 'Ruta Limpia · camión cerca',
      body:
        'El camión recolector pasará por P08 en ~8 min (aprox. 17:38). ' +
        'Saca tus residuos en bolsas cerradas.',
    });
  });

  it('rounds to whole minutes and never announces less than one minute', () => {
    const at = (seconds: number) =>
      buildProximityAlertMessage({
        ...input,
        predictedPassAt: new Date(input.now.getTime() + seconds * 1000),
      });

    expect(at(330).body).toContain('en ~6 min');
    expect(at(20)).toMatchObject({ secondsRemaining: 20 });
    expect(at(20).body).toContain('en ~1 min');
    expect(at(-30)).toMatchObject({ secondsRemaining: 0 });
  });

  it('formats early morning times with two digits', () => {
    const message = buildProximityAlertMessage({
      ...input,
      predictedPassAt: new Date('2026-10-20T12:05:00Z'),
      now: new Date('2026-10-20T11:58:00Z'),
    });

    expect(message.body).toContain('(aprox. 07:05)');
  });

  it('encodes the point code in the deep link', () => {
    expect(buildProximityAlertMessage({ ...input, pointCode: 'P 1&x' }).url).toBe('/?p=P%201%26x');
  });
});
