import { describe, expect, it } from 'vitest';

import { emptySheet, exposureOf, missingFields, problemsByField, toSheet } from './field-sheet';

const base = {
  ...emptySheet('2026-10-20'),
  pointCode: 'P08',
  phase: 'baseline' as const,
  observers: 'L.R.',
};

describe('exposureOf', () => {
  it('computes the exposure from the placement and pass times', () => {
    expect(
      exposureOf({ firstPlacementTime: '06:40', truckPassTime: '07:55', exposureMinutes: '30' }),
    ).toEqual({
      minutes: 75,
      computed: true,
    });
  });

  it('uses the typed exposure when a time is missing', () => {
    expect(
      exposureOf({ firstPlacementTime: '', truckPassTime: '07:55', exposureMinutes: '40' }),
    ).toEqual({
      minutes: 40,
      computed: false,
    });
    expect(exposureOf({ firstPlacementTime: '', truckPassTime: '', exposureMinutes: 'x' })).toEqual(
      {
        minutes: null,
        computed: false,
      },
    );
  });
});

describe('toSheet', () => {
  it('sends the computed exposure as null (the API computes it) and numbers as numbers', () => {
    const sheet = toSheet(
      {
        ...base,
        firstPlacementTime: '06:40',
        truckPassTime: '07:55',
        exposureMinutes: '10',
        bagsAtPass: '12',
        brokenBags: '3',
        wasteRemainingAfterPass: 'no',
      },
      'RI-01',
      false,
    );
    expect(sheet).toMatchObject({
      routeCode: 'RI-01',
      exposureMinutes: null,
      bagsAtPass: 12,
      brokenBags: 3,
      wasteRemainingAfterPass: false,
      music: null,
    });
  });

  it('sends music only at points that observe it', () => {
    const form = {
      ...base,
      musicWindowStart: '07:30',
      musicWindowEnd: '08:00',
      musicSeconds: '240',
    };
    expect(toSheet(form, 'RI-01', true).music).toEqual({
      windowStart: '07:30',
      windowEnd: '08:00',
      musicSeconds: 240,
      conditions: null,
    });
    expect(toSheet(form, 'RI-01', false).music).toBeNull();
  });
});

describe('sheet checks', () => {
  it('asks for the date, point, phase and observers before sending', () => {
    expect(Object.keys(missingFields(emptySheet('')))).toEqual([
      'observedOn',
      'pointCode',
      'phase',
      'observers',
    ]);
    expect(missingFields(base)).toEqual({});
  });

  it('places each API problem next to its field', () => {
    expect(problemsByField(['broken_bags_exceed_bags', 'other_cause_text_required'])).toEqual({
      brokenBags: 'Las bolsas rotas no pueden ser más que las bolsas al paso.',
      dispersionCauseOther: 'Describe la otra causa.',
    });
  });
});
