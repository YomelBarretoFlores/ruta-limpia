import { describe, expect, it } from 'vitest';

import { panelUser } from '../test/fixtures';
import { NAV_ITEMS, visibleNavItems, type NavItem } from './navigation';

const ITEMS: readonly NavItem[] = [
  { to: '/panel/en-vivo', label: 'En vivo', anyOf: ['live:read'] },
  { to: '/panel/fichas', label: 'Fichas', anyOf: ['field:read_own', 'field:read_all'] },
  { to: '/panel/usuarios', label: 'Usuarios', anyOf: ['users:manage'] },
];

const labels = (role: 'admin' | 'supervisor' | 'observer', items = ITEMS) =>
  visibleNavItems(panelUser(role), items).map((item) => item.label);

describe('visibleNavItems', () => {
  it('shows a section when the role has any of its permissions', () => {
    expect(labels('admin')).toEqual(['En vivo', 'Fichas', 'Usuarios']);
    expect(labels('supervisor')).toEqual(['En vivo', 'Fichas']);
    expect(labels('observer')).toEqual(['En vivo', 'Fichas']);
  });

  it('shows nothing for a user without permissions', () => {
    expect(visibleNavItems({ permissions: [] })).toEqual([]);
  });

  it('keeps user administration for administrators in the real navigation', () => {
    const users = NAV_ITEMS.filter((item) => item.anyOf.includes('users:manage'));
    expect(users.every((item) => item.anyOf.length === 1)).toBe(true);
    expect(labels('supervisor', NAV_ITEMS)).not.toContain('Usuarios');
  });

  it('gives each role its sections of the panel', () => {
    expect(labels('admin', NAV_ITEMS)).toEqual([
      'En vivo',
      'Viajes',
      'Incidencias',
      'Hogares',
      'Fichas de campo',
      'Línea base',
      'Encuestas',
      'Indicadores',
      'Exportaciones',
      'Usuarios',
    ]);
    expect(labels('supervisor', NAV_ITEMS)).toEqual([
      'En vivo',
      'Viajes',
      'Incidencias',
      'Hogares',
      'Fichas de campo',
      'Línea base',
      'Encuestas',
      'Indicadores',
      'Exportaciones',
    ]);
    expect(labels('observer', NAV_ITEMS)).toEqual([
      'En vivo',
      'Fichas de campo',
      'Línea base',
      'Indicadores',
    ]);
  });
});
