import { describe, expect, it } from 'vitest';

import { MAP_COLORS, truckIconSvg } from './truck-icon';

describe('truckIconSvg', () => {
  it('draws a solid ink square with a notch turned to the heading', () => {
    const svg = truckIconSvg({ stale: false, course: 90 });

    expect(svg).toContain(`fill="${MAP_COLORS.ink}"`);
    expect(svg).toContain('rotate(90 12 12)');
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('draws a hollow, dashed square when the signal is stale', () => {
    const svg = truckIconSvg({ stale: true, course: null });

    expect(svg).toContain(
      `<rect x="4" y="4" width="16" height="16" rx="2" fill="${MAP_COLORS.surface}"`,
    );
    expect(svg).toContain('stroke-dasharray');
    expect(svg).not.toContain('rotate(');
  });

  it('leaves the notch out when the heading is unknown or not a number', () => {
    expect(truckIconSvg({ stale: false, course: Number.NaN })).not.toContain('<path');
  });

  it('never uses an emoji', () => {
    expect(truckIconSvg({ stale: false, course: 10 })).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
