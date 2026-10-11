// Build-level guard: fails when the service worker would precache a file that only the municipal
// panel uses (its chunks, its CSS, a library only it imports such as `qrcode`), so a citizen's
// device never downloads the panel. Runs after `vite build`; reads the Vite build manifest
// (`dist/.vite/manifest.json`) and the precache list injected into `dist/sw.js`.
import { readFileSync } from 'node:fs';

const PANEL_ENTRY = 'src/panel/PanelApp.tsx';
const dist = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', dist), 'utf8'));
const serviceWorker = readFileSync(new URL('sw.js', dist), 'utf8');
const precached = new Set([...serviceWorker.matchAll(/"url":"([^"]+)"/g)].map((match) => match[1]));

/** Manifest keys reachable from `starts` through static and dynamic imports, never via `skip`. */
function reachable(starts, skip) {
  const seen = new Set();
  const pending = [...starts];
  while (pending.length > 0) {
    const key = pending.pop();
    if (seen.has(key) || key === skip) continue;
    seen.add(key);
    const chunk = manifest[key];
    if (chunk === undefined) throw new Error(`check-precache: ${key} is not in the build manifest`);
    pending.push(...(chunk.imports ?? []), ...(chunk.dynamicImports ?? []));
  }
  return seen;
}

/** The files a manifest entry emits: its chunk, its CSS and its other assets. */
const filesOf = (key) => [
  manifest[key].file,
  ...(manifest[key].css ?? []),
  ...(manifest[key].assets ?? []),
];

if (manifest[PANEL_ENTRY] === undefined) {
  throw new Error(`check-precache: ${PANEL_ENTRY} is not a chunk of the build`);
}
const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry === true);
const citizen = reachable(entries, PANEL_ENTRY);
const citizenFiles = new Set([...citizen].flatMap(filesOf));
const panelOnly = [...reachable([PANEL_ENTRY])]
  .filter((key) => !citizen.has(key))
  .flatMap(filesOf)
  .filter((file) => !citizenFiles.has(file));

// The precache list must have been found at all: the citizen entry is always in it.
const missing = entries.flatMap(filesOf).filter((file) => !precached.has(file));
if (missing.length > 0) {
  throw new Error(
    `check-precache: the precache list lacks the citizen files ${missing.join(', ')}`,
  );
}
const leaked = panelOnly.filter((file) => precached.has(file));
if (leaked.length > 0) {
  throw new Error(
    `check-precache: panel-only files are precached for citizens: ${leaked.join(', ')}. ` +
      'Add them to injectManifest.globIgnores in vite.config.ts.',
  );
}
console.log(
  `check-precache: ${precached.size} precached files, none of the ${panelOnly.length} panel-only files`,
);
