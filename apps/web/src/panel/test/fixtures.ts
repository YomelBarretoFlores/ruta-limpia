import type { RouteDetail } from '../../citizen/api/types';
import type { PanelUser, Permission, Role } from '../api/types';

const PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: [
    'live:read',
    'vehicles:read',
    'trips:read',
    'trips:write',
    'incidents:read',
    'incidents:create',
    'incidents:update',
    'households:read',
    'households:write',
    'households:delete',
    'field:read_own',
    'field:write_own',
    'field:read_all',
    'field:write_all',
    'users:manage',
  ],
  supervisor: [
    'live:read',
    'vehicles:read',
    'trips:read',
    'trips:write',
    'incidents:read',
    'incidents:create',
    'incidents:update',
    'households:read',
    'households:write',
    'field:read_own',
    'field:write_own',
    'field:read_all',
    'field:write_all',
  ],
  observer: ['live:read', 'incidents:create', 'field:read_own', 'field:write_own'],
};

/** A panel user with the permissions of the role, as `/auth/me` answers. */
export function panelUser(role: Role = 'admin', overrides: Partial<PanelUser> = {}): PanelUser {
  return {
    id: `user-${role}`,
    username: `${role}.test`,
    displayName: { admin: 'Ana Torres', supervisor: 'Luis Ramos', observer: 'Rosa Quispe' }[role],
    role,
    active: true,
    permissions: PERMISSIONS[role],
    createdAt: '2026-10-01T12:00:00.000Z',
    lastLoginAt: '2026-10-20T13:00:00.000Z',
    ...overrides,
  };
}

/** RI-01 with three of its points (P08 observes the music notice). */
export const PANEL_ROUTE: RouteDetail = {
  code: 'RI-01',
  name: 'Av. Centenario – Independencia',
  district: 'Independencia',
  lengthMeters: 1285.8,
  pointCount: 3,
  timeZone: 'America/Lima',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-77.52855, -9.523468],
      [-77.5279, -9.5241],
      [-77.5271, -9.5249],
    ],
  },
  points: [
    {
      code: 'P01',
      name: 'Av. Centenario · punto 1',
      sequence: 1,
      lat: -9.5232,
      lon: -77.5286,
      chainageMeters: 30,
      observesMusic: false,
    },
    {
      code: 'P08',
      name: 'Av. Centenario · punto 8',
      sequence: 8,
      lat: -9.5241,
      lon: -77.5279,
      chainageMeters: 640,
      observesMusic: true,
    },
    {
      code: 'P09',
      name: 'Av. Centenario · punto 9',
      sequence: 9,
      lat: -9.5249,
      lon: -77.5271,
      chainageMeters: 720,
      observesMusic: false,
    },
  ],
  schedule: [{ weekday: 1, plannedStart: '07:00' }],
};
