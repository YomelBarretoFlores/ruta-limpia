import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router';

import type { RouteSummary } from '../../citizen/api/types';
import { Button } from '../../shared/ui/Button';
import { Notice } from '../../shared/ui/Notice';
import { usePanelDeps } from '../panel-deps';
import { ROLE_LABELS } from '../session/permissions';
import { useSession, useUser } from '../session/session-context';
import { visibleNavItems } from './navigation';
import { SelectedRouteContext, type SelectedRoute } from './selected-route';

const ROUTE_KEY = 'ruta-limpia:panel-route';

function savedRoute(): string | null {
  try {
    return window.localStorage.getItem(ROUTE_KEY);
  } catch {
    return null;
  }
}

/**
 * The panel frame: a 232 px left navigation (a menu button under 900 px), a top bar with the
 * route selector and the user, and the current section.
 */
export function PanelShell() {
  const { api } = usePanelDeps();
  const user = useUser();
  const { signOut } = useSession();
  const [routes, setRoutes] = useState<readonly RouteSummary[]>([]);
  const [chosen, setChosen] = useState<string | null>(savedRoute);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const items = visibleNavItems(user);

  useEffect(() => {
    let current = true;
    api.listRoutes().then(
      (list) => current && setRoutes(list),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [api]);

  // Until the catalog answers, the remembered route; then a route that exists.
  const routeCode =
    routes.length === 0 ? chosen : (routes.find((r) => r.code === chosen) ?? routes[0]!).code;
  const selected = useMemo<SelectedRoute>(
    () => ({
      routes,
      routeCode,
      select: (code) => {
        setChosen(code);
        try {
          window.localStorage.setItem(ROUTE_KEY, code);
        } catch {
          // Not remembered: the selection still holds for this visit.
        }
      },
    }),
    [routes, routeCode],
  );

  return (
    <SelectedRouteContext.Provider value={selected}>
      <div className="panel" data-density="panel">
        <a className="panel-skip" href="#contenido">
          Saltar al contenido
        </a>
        <header className="panel-topbar no-print">
          <div className="panel-topbar__brand">
            <p className="panel-wordmark">Ruta Limpia</p>
            <p className="panel-topbar__sub">Panel municipal</p>
          </div>
          <button
            type="button"
            className="panel-menu-button"
            aria-expanded={menuOpen}
            aria-controls="panel-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            Menú
          </button>
          <div className="panel-topbar__route">
            <label htmlFor="panel-route">Ruta</label>
            <select
              id="panel-route"
              className="select"
              value={routeCode ?? ''}
              disabled={routes.length < 2}
              onChange={(event) => selected.select(event.target.value)}
            >
              {routes.length === 0 && <option value="">{routeCode ?? '—'}</option>}
              {routes.map((route) => (
                <option key={route.code} value={route.code}>
                  {route.code} · {route.name}
                </option>
              ))}
            </select>
          </div>
          <div className="panel-topbar__user">
            <span>
              <strong>{user.displayName}</strong>
              <span className="panel-topbar__role"> · {ROLE_LABELS[user.role]}</span>
            </span>
            <Button
              variant="secondary"
              className="button--compact"
              onClick={() => {
                setSignOutError(null);
                void signOut().then(setSignOutError);
              }}
            >
              Salir
            </Button>
          </div>
        </header>
        <nav
          id="panel-nav"
          className={menuOpen ? 'panel-nav panel-nav--open no-print' : 'panel-nav no-print'}
          aria-label="Secciones del panel"
        >
          <ul>
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className="panel-nav__link"
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main id="contenido" className="panel-main" tabIndex={-1}>
          {signOutError !== null && (
            <Notice tone="danger" title="No se pudo cerrar la sesión">
              <p>{signOutError}</p>
            </Notice>
          )}
          <Outlet />
        </main>
      </div>
    </SelectedRouteContext.Provider>
  );
}
