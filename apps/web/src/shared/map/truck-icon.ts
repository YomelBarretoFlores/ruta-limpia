/** Map colors, mirroring tokens.css (Leaflet paths take literal colors, not CSS variables). */
export const MAP_COLORS = Object.freeze({
  ink: '#1d2320',
  accent: '#24604a',
  surface: '#ffffff',
});

/** Size of the truck icon in CSS pixels (a 16 px body plus room for the heading notch). */
export const TRUCK_ICON_SIZE = 24;

/**
 * The truck as an inline SVG: a 16 px ink square with a small notch pointing to its heading (when
 * known). With a stale signal it is hollow with a dashed outline: it shows where the truck was
 * last seen, not where it is.
 */
export function truckIconSvg({
  stale,
  course,
}: {
  readonly stale: boolean;
  readonly course: number | null;
}): string {
  const fill = stale ? MAP_COLORS.surface : MAP_COLORS.ink;
  const stroke = stale ? MAP_COLORS.ink : MAP_COLORS.surface;
  const dash = stale ? ' stroke-dasharray="3 2"' : '';
  const notch =
    course === null || !Number.isFinite(course)
      ? ''
      : `<path d="M12 0.5 L15.5 4 H8.5 Z" fill="${stale ? MAP_COLORS.surface : MAP_COLORS.ink}"` +
        ` stroke="${MAP_COLORS.ink}" stroke-width="1" transform="rotate(${Math.round(course) % 360} 12 12)"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TRUCK_ICON_SIZE}" height="${TRUCK_ICON_SIZE}"` +
    ` viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    notch +
    `<rect x="4" y="4" width="16" height="16" rx="2" fill="${fill}" stroke="${stroke}"` +
    ` stroke-width="2"${dash}/>` +
    `</svg>`
  );
}
