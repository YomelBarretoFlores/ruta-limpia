import { describe, expect, it } from 'vitest';

import { MAP_COLORS } from '../../shared/map/truck-icon';
import {
  decimateTrack,
  MAX_TRACK_VERTICES,
  plannedRouteStyle,
  TRACK_LINE,
  TRACK_VERTEX,
} from './map-styles';

describe('trip map styles', () => {
  it('draws the planned route at full strength without a track', () => {
    expect(plannedRouteStyle(false).line).toMatchObject({
      color: MAP_COLORS.accent,
      weight: 6,
      opacity: 1,
    });
  });

  it('steps the planned route back under a GPS track, which is solid ink with its fixes', () => {
    expect(plannedRouteStyle(true).line).toMatchObject({
      color: MAP_COLORS.accent,
      weight: 4,
      opacity: 0.35,
    });
    expect(TRACK_LINE).toMatchObject({ color: MAP_COLORS.ink, weight: 3, opacity: 1 });
    expect(TRACK_LINE).not.toHaveProperty('dashArray');
    expect(TRACK_VERTEX).toMatchObject({ fillColor: MAP_COLORS.ink, fillOpacity: 1 });
  });
});

describe('decimateTrack', () => {
  it('keeps a short track whole', () => {
    const track = [1, 2, 3];
    expect(decimateTrack(track)).toBe(track);
  });

  it('keeps at most 200 evenly spaced dots of a long track, with its first and last', () => {
    const track = Array.from({ length: 5000 }, (_, i) => i);

    const dots = decimateTrack(track);

    expect(dots).toHaveLength(MAX_TRACK_VERTICES);
    expect(dots[0]).toBe(0);
    expect(dots.at(-1)).toBe(4999);
    const gaps = dots.slice(1).map((value, i) => value - (dots[i] ?? 0));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  });
});
