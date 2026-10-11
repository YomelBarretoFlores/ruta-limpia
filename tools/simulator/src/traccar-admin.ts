import type { Fetch } from './osmand.js';

export interface TraccarBootstrapOptions {
  /** Traccar's web/REST address, for example http://127.0.0.1:8082. */
  readonly baseUrl: string;
  readonly email: string;
  readonly password: string;
  /** The tracker's identifier (`SEED_VEHICLE_UNIQUE_ID`), as the API's vehicle has it. */
  readonly deviceUniqueId: string;
  readonly deviceName: string;
  readonly fetch?: Fetch;
}

export interface TraccarBootstrapResult {
  /** Whether this run created the first administrator (a new server). */
  readonly adminCreated: boolean;
  readonly deviceCreated: boolean;
  readonly deviceId: number;
}

const CREDENTIALS_HINT = 'check TRACCAR_ADMIN_EMAIL and TRACCAR_ADMIN_PASSWORD';

/**
 * Prepares Traccar for the simulator, idempotently (Traccar 6.16 REST API):
 *
 * 1. a new server (`GET /api/server` says `newServer`) gets its first user, `POST /api/users`,
 *    which Traccar makes administrator because the user table is empty;
 * 2. with HTTP Basic credentials, the device whose `uniqueId` is the vehicle's is looked up
 *    (`GET /api/devices?uniqueId=`) and created only when missing (`POST /api/devices`). Traccar
 *    refuses OsmAnd fixes from unknown devices, so the drive needs this.
 *
 * The password only travels to Traccar; it never appears in an error message.
 */
export async function bootstrapTraccar(
  options: TraccarBootstrapOptions,
): Promise<TraccarBootstrapResult> {
  const fetchImpl = options.fetch ?? fetch;
  if (options.email === '' || options.password === '') {
    throw new Error(
      'Set TRACCAR_ADMIN_EMAIL and TRACCAR_ADMIN_PASSWORD (the Traccar administrator).',
    );
  }
  const url = (path: string) => new URL(path, options.baseUrl).toString();
  const json = { 'content-type': 'application/json', accept: 'application/json' };

  const server = await fetchImpl(url('/api/server'), { headers: { accept: 'application/json' } });
  if (!server.ok) throw new Error(`Traccar is not answering (GET /api/server: ${server.status}).`);
  const { newServer } = (await server.json()) as { newServer?: boolean };

  let adminCreated = false;
  if (newServer === true) {
    const created = await fetchImpl(url('/api/users'), {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        name: 'Administrador',
        email: options.email,
        password: options.password,
      }),
    });
    if (!created.ok) {
      throw new Error(`Traccar refused to create its first administrator (${created.status}).`);
    }
    const user = (await created.json()) as { administrator?: boolean };
    if (user.administrator !== true) {
      throw new Error(
        'Traccar created the user without administrator rights: it already had users.',
      );
    }
    adminCreated = true;
  }

  const auth = {
    ...json,
    authorization: `Basic ${Buffer.from(`${options.email}:${options.password}`).toString('base64')}`,
  };
  const query = new URLSearchParams({ uniqueId: options.deviceUniqueId });
  const found = await fetchImpl(url(`/api/devices?${query.toString()}`), { headers: auth });
  if (found.status === 401) {
    await found.body?.cancel();
    throw new Error(`Traccar rejected the administrator credentials: ${CREDENTIALS_HINT}.`);
  }
  if (!found.ok) throw new Error(`Traccar could not list the devices (${found.status}).`);
  const devices = (await found.json()) as { id: number; uniqueId: string }[];
  const existing = devices.find((device) => device.uniqueId === options.deviceUniqueId);
  if (existing !== undefined) return { adminCreated, deviceCreated: false, deviceId: existing.id };

  const created = await fetchImpl(url('/api/devices'), {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: options.deviceName, uniqueId: options.deviceUniqueId }),
  });
  if (!created.ok) throw new Error(`Traccar refused to create the device (${created.status}).`);
  const device = (await created.json()) as { id: number };
  return { adminCreated, deviceCreated: true, deviceId: device.id };
}
