import { describe, expect, it } from 'vitest';

import tokensCss from './tokens.css?raw';

/** The color tokens declared in tokens.css (`--name: #rrggbb;`). */
function colorTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const [, name, hex] of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    if (name !== undefined && hex !== undefined) tokens.set(name, hex.toLowerCase());
  }
  return tokens;
}

/** WCAG 2.x relative luminance of an sRGB color. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Body text (4.5:1). */
const TEXT = 4.5;
/** Large text (≥ 24 px, or 600 weight ≥ 18.66 px), control boundaries and focus rings (3:1). */
const LARGE_OR_UI = 3;

/** Every foreground/background pair the components use, with the minimum it must reach. */
const PAIRS: readonly (readonly [fg: string, bg: string, min: number, use: string])[] = [
  ['ink', 'paper', TEXT, 'page text'],
  ['ink', 'surface', TEXT, 'section text'],
  ['ink', 'fill', TEXT, 'table header, read-only input'],
  ['ink-2', 'paper', TEXT, 'secondary text on the page (header district, footer)'],
  ['ink-2', 'surface', TEXT, 'kicker, hint, "Actualizado"'],
  ['ink-2', 'fill', TEXT, 'secondary text on fills'],
  ['ink-3', 'surface', TEXT, 'tertiary text (only on surface)'],
  ['ink-3', 'fill', LARGE_OR_UI, 'disabled button text (exempt; kept legible)'],
  ['on-accent', 'accent', TEXT, 'primary button'],
  ['on-accent', 'accent-strong', TEXT, 'primary button, hover'],
  ['accent', 'surface', TEXT, 'links, "En vivo"'],
  ['accent', 'paper', TEXT, 'links on the page'],
  ['ink', 'accent-tint', TEXT, 'info notice, selected row'],
  ['ink', 'warn-tint', TEXT, 'stale notice text'],
  ['warn', 'warn-tint', TEXT, 'stale notice title'],
  ['ink', 'danger-tint', TEXT, 'error notice text'],
  ['danger', 'danger-tint', TEXT, 'error notice title'],
  ['danger', 'surface', TEXT, 'destructive button, field error'],
  ['rule-control', 'surface', LARGE_OR_UI, 'input and select borders'],
  ['accent', 'surface', LARGE_OR_UI, 'route line, household point, checkbox'],
  ['ink', 'surface', LARGE_OR_UI, 'truck marker, reference-point stroke'],
  ['focus', 'ink', LARGE_OR_UI, 'focus ring against its inner ink ring'],
  ['ink', 'paper', LARGE_OR_UI, 'inner focus ring on the page'],
];

describe('design tokens', () => {
  const tokens = colorTokens(tokensCss);

  it.each(PAIRS)('%s on %s reaches %s:1 (%s)', (fg, bg, min) => {
    const foreground = tokens.get(fg);
    const background = tokens.get(bg);
    expect(foreground, `--${fg} is declared`).toBeDefined();
    expect(background, `--${bg} is declared`).toBeDefined();

    expect(contrast(foreground ?? '', background ?? '')).toBeGreaterThanOrEqual(min);
  });

  it('declares no saturated or neon color: chroma stays under 0.5, except the focus ring', () => {
    for (const [name, hex] of tokens) {
      if (name === 'focus') continue;
      const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const chroma = Math.max(...channels) - Math.min(...channels);
      expect(chroma, `--${name} ${hex}`).toBeLessThan(0.5);
    }
  });

  it('computes the WCAG ratio (black on white is 21:1)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
});
