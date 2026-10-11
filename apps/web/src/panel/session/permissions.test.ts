import { describe, expect, it } from 'vitest';

import { safeReturnPath } from './permissions';

describe('safeReturnPath', () => {
  it.each([
    ['/panel', '/panel'],
    ['/panel/', '/panel/'],
    ['/panel/usuarios', '/panel/usuarios'],
    ['/panel?ruta=RI-01', '/panel?ruta=RI-01'],
    ['/panel/viajes?estado=active', '/panel/viajes?estado=active'],
  ])('keeps the panel path %s', (value, expected) => {
    expect(safeReturnPath(value)).toBe(expected);
  });

  it.each([
    ['nothing', null],
    ['an empty value', ''],
    ['an absolute URL', 'https://evil.example/panel'],
    ['a protocol-relative URL', '//evil.example/panel'],
    ['a look-alike prefix', '/panelx'],
    ['a look-alike segment', '/panel-falso/usuarios'],
    ['a backslash form', '/panel\\evil.example'],
    ['a backslash host', '/\\evil.example/panel'],
    ['a query only', '?volver=/panel'],
    ['a relative path', 'panel/usuarios'],
    ['a citizen page', '/?r=RI-01'],
    ['a javascript: URL', 'javascript:alert(1)'],
  ])('falls back to /panel for %s', (_, value) => {
    expect(safeReturnPath(value)).toBe('/panel');
  });
});
