import { describe, expect, it } from 'vitest';

import { MAP_COLORS } from '../../shared/map/truck-icon';
import { plannedRouteStyle, TRACK_LINE, TRACK_VERTEX } from './map-styles';

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
