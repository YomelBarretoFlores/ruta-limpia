/**
 * `pnpm sim:bootstrap`: creates the first Traccar administrator on a new server and the
 * simulated truck's device, idempotently. Reads TRACCAR_URL (default http://127.0.0.1:8082),
 * TRACCAR_ADMIN_EMAIL, TRACCAR_ADMIN_PASSWORD, SEED_VEHICLE_UNIQUE_ID (default
 * ruta-limpia-unidad-a) and TRACCAR_DEVICE_NAME (default "Unidad A"). The password is never printed.
 */
import { bootstrapTraccar } from './traccar-admin.js';

const env = process.env;
const deviceUniqueId = env['SEED_VEHICLE_UNIQUE_ID'] || 'ruta-limpia-unidad-a';

try {
  const result = await bootstrapTraccar({
    baseUrl: env['TRACCAR_URL'] || 'http://127.0.0.1:8082',
    email: env['TRACCAR_ADMIN_EMAIL'] ?? '',
    password: env['TRACCAR_ADMIN_PASSWORD'] ?? '',
    deviceUniqueId,
    deviceName: env['TRACCAR_DEVICE_NAME'] || 'Unidad A',
  });
  console.log(
    result.adminCreated
      ? 'Traccar: first administrator created.'
      : 'Traccar: administrator already set up.',
  );
  console.log(
    `Traccar: device "${deviceUniqueId}" ${result.deviceCreated ? 'created' : 'already registered'} (id ${result.deviceId}).`,
  );
} catch (error) {
  console.error(`bootstrap-traccar: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
