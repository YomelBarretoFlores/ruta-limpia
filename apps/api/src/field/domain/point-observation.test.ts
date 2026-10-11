import { describe, expect, it } from 'vitest';

import { fieldEditVerdict, canReadFieldRecord } from './field-record-access.js';
import {
  observationProblems,
  resolveExposureMinutes,
  type PointObservationFacts,
} from './point-observation.js';

const EMPTY: PointObservationFacts = {
  firstPlacementTime: null,
  truckPassTime: null,
  exposureMinutes: null,
  bagsAtPass: null,
  brokenBags: null,
  dispersion: null,
  dispersionCauses: [],
  dispersionCauseOther: null,
  wasteRemainingAfterPass: null,
  photoBefore: { taken: false, code: null },
  photoAfter: { taken: false, code: null },
  music: null,
};
const MUSIC_POINT = { observesMusic: true };
const PLAIN_POINT = { observesMusic: false };

describe('exposure of the first bag', () => {
  it('is computed from the placement and pass times when both were observed', () => {
    expect(
      resolveExposureMinutes({ ...EMPTY, firstPlacementTime: '06:40', truckPassTime: '07:55' }),
    ).toEqual({ minutes: 75, computed: true });
  });

  it('keeps the observed value when a time is missing, and is null otherwise', () => {
    expect(
      resolveExposureMinutes({ ...EMPTY, truckPassTime: '07:55', exposureMinutes: 30 }),
    ).toEqual({ minutes: 30, computed: false });
    expect(resolveExposureMinutes(EMPTY)).toEqual({ minutes: null, computed: false });
  });
});

describe('observation consistency', () => {
  it('accepts an empty sheet and a complete one', () => {
    expect(observationProblems(EMPTY, PLAIN_POINT)).toEqual([]);
    expect(
      observationProblems(
        {
          ...EMPTY,
          firstPlacementTime: '06:40',
          truckPassTime: '07:55',
          bagsAtPass: 12,
          brokenBags: 3,
          dispersion: 'many',
          dispersionCauses: ['animals', 'other'],
          dispersionCauseOther: 'Recyclers opened bags',
          wasteRemainingAfterPass: true,
          photoBefore: { taken: true, code: 'F-P08-001' },
          photoAfter: { taken: true, code: null },
          music: {
            windowStart: '07:30',
            windowEnd: '08:00',
            musicSeconds: 240,
            conditions: 'Wind',
          },
        },
        MUSIC_POINT,
      ),
    ).toEqual([]);
  });

  it('reports every inconsistency', () => {
    expect(
      observationProblems(
        {
          ...EMPTY,
          firstPlacementTime: '08:00',
          truckPassTime: '07:55',
          bagsAtPass: 2,
          brokenBags: 3,
          dispersion: 'none',
          dispersionCauses: ['wind'],
          dispersionCauseOther: 'stray text',
          photoBefore: { taken: false, code: 'F-1' },
          music: { windowStart: '07:30', windowEnd: '07:40', musicSeconds: 10, conditions: null },
        },
        PLAIN_POINT,
      ),
    ).toEqual([
      'pass_before_placement',
      'broken_bags_exceed_bags',
      'causes_without_dispersion',
      'other_cause_text_required',
      'photo_code_without_photo',
      'music_not_observed_at_point',
    ]);
  });

  it('requires a text for the "other" cause and a sensible music window', () => {
    expect(
      observationProblems(
        { ...EMPTY, dispersion: 'few', dispersionCauses: ['other'] },
        PLAIN_POINT,
      ),
    ).toEqual(['other_cause_text_required']);
    const music = { windowStart: '07:30', windowEnd: '07:30', musicSeconds: 0, conditions: null };
    expect(observationProblems({ ...EMPTY, music }, MUSIC_POINT)).toEqual(['music_window_invalid']);
    expect(
      observationProblems(
        { ...EMPTY, music: { ...music, windowEnd: '07:31', musicSeconds: 61 } },
        MUSIC_POINT,
      ),
    ).toEqual(['music_seconds_exceed_window']);
  });
});

describe('field record access', () => {
  const T0 = new Date('2026-10-20T12:00:00Z');
  const own = { createdByUserId: 'obs-1', createdAt: T0 };
  const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);

  it('lets observers read and edit their own records within 24 hours only', () => {
    expect(canReadFieldRecord('observer', 'obs-1', own)).toBe(true);
    expect(canReadFieldRecord('observer', 'obs-2', own)).toBe(false);
    expect(fieldEditVerdict('observer', 'obs-1', own, hours(23.9))).toBe('allowed');
    expect(fieldEditVerdict('observer', 'obs-1', own, hours(24))).toBe('edit_window_closed');
    expect(fieldEditVerdict('observer', 'obs-2', own, hours(1))).toBe('not_owner');
  });

  it('lets supervisors and administrators read and edit any record at any time', () => {
    for (const role of ['supervisor', 'admin'] as const) {
      expect(canReadFieldRecord(role, 'x', own)).toBe(true);
      expect(fieldEditVerdict(role, 'x', own, hours(500))).toBe('allowed');
    }
  });
});
