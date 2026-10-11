/**
 * `pnpm sim:drive`: drives the truck along RI-01, sending OsmAnd fixes to Traccar in real time.
 * Reads OSMAND_URL (default http://127.0.0.1:5055) and SEED_VEHICLE_UNIQUE_ID (default
 * ruta-limpia-unidad-a). Run `pnpm sim:drive --help` for the options.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

import { sendOsmAnd } from './osmand.js';
import { planRi01Drive, RI01_STOPS, type PlannedFix } from './ri01-drive-plan.js';

const HELP = `Drives RI-01 through Traccar (OsmAnd).

Options:
  --interval <s>   seconds between fixes, 15 to 30 (default 20)
  --speed <m/s>    speed between points (default 3.5)
  --dwell <s>      seconds stopped at each point (default 40)
  --noise <m>      random GPS error radius in metres (default 0)
  --seed <n>       seed of the noise (default 1)
  --gap-at <s>     start a signal gap this many seconds into the drive
  --gap-for <s>    length of the gap (default 90: over 60 s turns the ETA stale)
  --speedup <n>    compress time n times; timestamps follow the wall clock (default 1)
  --dry-run        print the fixes without sending them
  --help           show this help`;

const { values } = parseArgs({
  options: {
    interval: { type: 'string', default: '20' },
    speed: { type: 'string', default: '3.5' },
    dwell: { type: 'string', default: '40' },
    noise: { type: 'string', default: '0' },
    seed: { type: 'string', default: '1' },
    'gap-at': { type: 'string' },
    'gap-for': { type: 'string', default: '90' },
    speedup: { type: 'string', default: '1' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const env = process.env;
const osmAndUrl = env['OSMAND_URL'] || 'http://127.0.0.1:5055';
const deviceId = env['SEED_VEHICLE_UNIQUE_ID'] || 'ruta-limpia-unidad-a';
const speedup = Number(values.speedup);
if (!(speedup >= 1)) throw new RangeError('--speedup must be 1 or more.');

const startWall = Date.now();
const plan = planRi01Drive({
  startAt: new Date(startWall),
  intervalSec: Number(values.interval),
  cruiseSpeedMps: Number(values.speed),
  dwellSec: Number(values.dwell),
  noiseMeters: Number(values.noise),
  seed: Number(values.seed),
  gap:
    values['gap-at'] === undefined
      ? null
      : { atSec: Number(values['gap-at']), durationSec: Number(values['gap-for']) },
});

/** The last point reached at `chainage`, for the log. */
const pointAt = (chainage: number) =>
  RI01_STOPS.filter((stop) => stop.chainage <= chainage + 1e-6).at(-1)?.code ?? 'start';

/** With a speedup, a fix is stamped with the wall-clock time it is sent at. */
const stamped = (fix: PlannedFix): PlannedFix =>
  speedup === 1 ? fix : { ...fix, at: new Date(startWall + (fix.offsetSec * 1000) / speedup) };

console.log(
  `RI-01: ${plan.fixes.length} fixes over ${Math.round(plan.durationSec / 60)} min of drive` +
    `${speedup === 1 ? '' : ` (${speedup}x faster)`}, device "${deviceId}" → ${osmAndUrl}` +
    `${plan.skipped > 0 ? `, ${plan.skipped} left out by the signal gap` : ''}.`,
);

for (const planned of plan.fixes) {
  const fix = stamped(planned);
  const wait = startWall + (fix.offsetSec * 1000) / speedup - Date.now();
  if (!values['dry-run'] && wait > 0) await sleep(wait);
  const line =
    `+${String(fix.offsetSec).padStart(4)} s  ${fix.chainage.toFixed(0).padStart(5)} m  ` +
    `${fix.speedKnots.toFixed(1).padStart(4)} kn  last point ${pointAt(fix.chainage)}`;
  if (values['dry-run']) {
    console.log(`${line}  ${fix.lat.toFixed(6)},${fix.lon.toFixed(6)}`);
    continue;
  }
  try {
    await sendOsmAnd(osmAndUrl, deviceId, fix);
    console.log(line);
  } catch (error) {
    console.error(`drive-ri01: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
console.log('RI-01: the truck reached the end of the route.');
