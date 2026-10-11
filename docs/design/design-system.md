# Ruta Limpia — design system

A civic service, not a startup landing page. The interface must look deliberately designed and
trustworthy, in the tradition of public-service design systems (GOV.UK, USWDS), and must be easy to
read outdoors, on low-end Android phones, by older residents.

## Principles

1. **Information first.** The arrival window, the signal state, and the next action dominate. Decoration
   never competes with data.
2. **One accent, used sparingly.** Color carries meaning (state, primary action, the route line), not
   mood.
3. **Flat and ruled.** Hierarchy comes from type, spacing, and hairline rules — not shadows, glows, or
   gradients.
4. **Legible by default.** Large base size, high contrast, generous line height, tabular numerals for
   times and counts.
5. **Honest states.** Stale data looks stale. Missing data says so in words. Nothing pretends to be live.

## Explicitly forbidden

No gradients (backgrounds, buttons, text, borders). No saturated or neon colors. No glassmorphism, blur,
or translucent panels. No drop shadows on cards (a 1 px shadow is allowed only on floating map controls).
No emoji as icons. No pill-shaped "badges" in bright colors. No large border radii (max 4 px; 999 px only
for the 8 px status dot). No decorative illustrations, blobs, or hero images. No animated skeleton
shimmer. No centered marketing-style layouts on data screens.

## Typeface

- **Atkinson Hyperlegible Next** (variable), self-hosted via
  `@fontsource-variable/atkinson-hyperlegible-next` — designed by the Braille Institute for low-vision
  legibility. No CDN (privacy and offline PWA).
- Fallback stack: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- Times, counts and codes use `font-variant-numeric: tabular-nums` (the `.num` utility, or the `Num`
  component).
- **Verified (2026-10-11, `@fontsource-variable/atkinson-hyperlegible-next` 5.3.0, latin subset):**
  the face's GSUB table carries `tnum` (with `pnum`, `frac`, `ccmp`, `locl`); its default figures
  are proportional (advances 407–648 units), so `tabular-nums` matters and works. No second face
  (Public Sans) is needed. Checked with fontTools on the shipped `woff2`.

### Scale (rem, root 16 px)

| Token            | Citizen | Panel | Use                                 |
| ---------------- | ------- | ----- | ----------------------------------- |
| `--text-xs`      | 0.875   | 0.75  | Legal notes, map attribution        |
| `--text-sm`      | 1       | 0.875 | Secondary text, table cells (panel) |
| `--text-md`      | 1.125   | 1     | Body (citizen base is 18 px)        |
| `--text-lg`      | 1.375   | 1.125 | Section titles                      |
| `--text-xl`      | 1.75    | 1.5   | Page title                          |
| `--text-display` | 2.5     | 2     | The arrival window ("8 a 12 min")   |

Weights: 400 body, 600 titles and labels, 700 only for the arrival window. Line height 1.5 body,
1.2 display. Max line length 65ch.

## Color tokens

| Token             | Hex       | Use                                                         |
| ----------------- | --------- | ----------------------------------------------------------- |
| `--ink`           | `#1d2320` | Primary text, icons                                         |
| `--ink-2`         | `#4a5550` | Secondary text (AA on paper and surface)                    |
| `--ink-3`         | `#6b7570` | Tertiary; only ≥ 18 px or non-essential                     |
| `--paper`         | `#f6f5f1` | Page background (warm off-white)                            |
| `--surface`       | `#ffffff` | Panels, inputs, table body                                  |
| `--fill`          | `#ecebe5` | Subtle fills, table header, disabled                        |
| `--rule`          | `#d9d7cf` | Hairline borders and dividers                               |
| `--rule-strong`   | `#b9b7ae` | Table outer border (decorative structure only)              |
| `--rule-control`  | `#8a877e` | Borders of inputs, selects, checkboxes (3:1 on `--surface`) |
| `--accent`        | `#24604a` | Primary action, route line, selected state, "en vivo"       |
| `--accent-strong` | `#1b4a39` | Hover / pressed                                             |
| `--accent-tint`   | `#e3ece6` | Selected row, chosen point background                       |
| `--warn`          | `#7a4f00` | Text/border for stale, pending (on `--warn-tint`)           |
| `--warn-tint`     | `#f5ecd7` | Stale / attention background                                |
| `--danger`        | `#9b2c22` | Errors, failed delivery, signal lost                        |
| `--danger-tint`   | `#f6e4e1` | Error background                                            |
| `--focus`         | `#ffbf47` | Focus ring (with an `--ink` inner ring)                     |

Every text/background pair must meet WCAG 2.2 AA (4.5:1; 3:1 for ≥ 24 px or 600-weight ≥ 18.66 px).
`apps/web/src/shared/styles/tokens.test.ts` parses `tokens.css` and checks every pair the
components use (see the table in that file); a new pair must be added there.

Refinements made while building (the decisions stand):

- `--rule-strong` measures 2.0:1 on white, below the 3:1 that WCAG 1.4.11 asks of a control's
  boundary. Inputs therefore use the new `--rule-control` (`#8a877e`, 3.6:1 on `--surface`);
  `--rule-strong` stays for table frames.
- `--ink-3` reaches 4.8:1 on `--surface` but only 4.4:1 on `--paper`: use it on `--surface` only.
  On `--fill` (disabled buttons) it is 4.0:1; disabled controls are exempt, and it still passes 3:1.

State colors are always paired with words (and, in the panel, an 8 px square/dot), never color alone.

## Space, shape, lines

- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48, 64. Tokens `--space-1` … `--space-8`.
- Radius: `--radius-sm: 2px` (inputs, tags), `--radius: 4px` (panels, buttons). Nothing larger.
- Borders: 1 px `--rule` for sections; 1 px `--rule-control` for inputs, selects and checkboxes
  (3:1 on `--surface`, WCAG 1.4.11); 1 px `--rule-strong` for table frames only; 4 px left border in
  a state color for notices (GOV.UK-style inset text).
- Touch targets ≥ 48 × 48 px (citizen), ≥ 40 px (panel).
- Focus: `outline: 3px solid var(--focus); outline-offset: 1px; box-shadow: 0 0 0 1px var(--ink)` —
  an ink inner ring with the yellow outside it (with `outline-offset: 0` the outline would paint over
  the 1 px ring), visible on every interactive element, on light and dark backgrounds alike.

## Components

- **Section** (replaces "card"): white surface, 1 px rule, 4 px radius, 24 px padding, a 600-weight
  title and an optional `--ink-2` kicker line above it (e.g. "Independencia · tramo RI-01").
- **Button**: primary = solid `--accent`, white text, 600 weight, 48 px min height, no shadow, no
  gradient; hover `--accent-strong`; secondary = `--surface` with 1 px `--ink` border; destructive =
  text button in `--danger` with underline. Disabled = `--fill` with `--ink-3` text.
- **Notice**: 4 px left border (`--accent` info, `--warn` stale, `--danger` error) on a tint
  background, plain text, optional bold first line. No icons required.
- **Field**: label above (600), hint below label in `--ink-2`, input 1 px `--rule-control`, 2 px radius;
  error = 4 px left border `--danger` around the group plus message text.
- **Status**: text + 8 px square swatch. Values: "En vivo" (accent), "Sin actualización" (warn),
  "Sin señal" (danger), "Sin recorrido" (ink-3). It reports the truck's signal; the page's own
  connection is a separate status shown only when degraded ("Reconectando…").
- **Data table (panel)**: full-width, 1 px outer border, header on `--fill`, 600 weight `--text-sm`,
  row dividers `--rule`, zebra off, numbers right-aligned with tabular nums, times `HH:MM`, selected row
  `--accent-tint`. Sticky header on long tables.
- **Arrival display (citizen)**: "Llegada estimada" label (`--text-sm`, `--ink-2`), then the window in
  `--text-display` 700 ("8 a 12 min"), then "Actualizado 17:30" in `--ink-2`. When stale, the number is
  REMOVED (not greyed) and replaced by a warn notice and the printed schedule.

## Map

- OSM tiles muted with CSS on the tile pane only:
  `filter: grayscale(1) contrast(0.92) brightness(1.04);` (keep attribution legible and unfiltered).
- Route: 6 px `--accent` line over an 9 px white casing.
- The map opens fitted to the whole route (24 px padding), and fits again when the route changes;
  zoom stays between 13 (neighborhood) and 18 (street). Height: 280 px on phones, 320 px from 600 px.
- Reference points: 8 px white circles with a 1.5 px `--ink` stroke, small enough to leave the route
  line visible between them; the household's point is a 14 px `--accent` filled circle with a white
  2 px stroke and a permanent label ("Tu punto · P08").
- Truck: 16 px `--ink` filled square-ish marker with a small heading notch (inline SVG), no emoji; when
  stale, render it hollow with a dashed outline and the label "Última posición 17:22".
- Controls: zoom buttons flat, 1 px `--rule-strong`, 1 px shadow allowed.

## Layout

- **Citizen**: single column, max-width 36rem, 16 px side padding, sections stacked with 16 px gaps;
  header is a plain wordmark "Ruta Limpia" (600, ink) with the district underneath — no logo blob.
  Order: arrival section (map + arrival display), alerts section, how-to section (short instructions),
  footer with privacy note and project credit ("Proyecto RSU UNASAM 2026").
- **Panel**: app shell with a 232 px left navigation (text links, current item with 4 px left accent
  bar), a top bar (route selector, user menu), content max-width none, 24 px gutters. Live view: three
  summary blocks in a row (Vehículo, Señal GPS, Última posición) styled as label + value, NOT colored
  tiles; below, the per-point table (Punto | Paso registrado | Estado del aviso | Entregas | Incidencia);
  map in a right column on wide screens (≥ 1200 px), stacked below on narrower.
- Print stylesheet for household QR stickers: plain black on white, code and short instruction.

## Motion

Only 120–150 ms color/opacity transitions on hover/focus. No entrance animations, no shimmer.
`prefers-reduced-motion: reduce` disables all transitions. Live updates do not flash or pulse; a changed
value may get a 1 s `--accent-tint` background fade at most (disabled under reduced motion).

## Voice (Spanish, Peru — neutral)

Sentence case. Short sentences. Verbs first on buttons ("Activar avisos", "Cancelar avisos",
"Registrar incidencia"). Times as "17:30". Never blame the user in errors; say what happened and what to do.

## Implementation map

| Piece                                                  | Where                                                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Tokens (color, type scale, space, radius, motion)      | `apps/web/src/shared/styles/tokens.css`                                                                  |
| Base, typography, focus, reduced motion, print, `.num` | `apps/web/src/shared/styles/global.css`                                                                  |
| Primitives                                             | `apps/web/src/shared/ui/` — `Section`, `Button`, `Notice`, `Field`, `Status`, `Num` (styles in `ui.css`) |
| Contrast check                                         | `apps/web/src/shared/styles/tokens.test.ts`                                                              |
| Citizen screens                                        | `apps/web/src/citizen/` (styles in `citizen.css`)                                                        |

The panel scale applies inside an element with `data-density="panel"`; the citizen scale is the
default.
