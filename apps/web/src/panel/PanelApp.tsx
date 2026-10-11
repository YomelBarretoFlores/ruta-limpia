import './panel.css';

import { Route, Routes } from 'react-router';

import { ErrorBoundary } from '../shared/ui/ErrorBoundary';
import { Notice } from '../shared/ui/Notice';
import { BaselineEditorPage } from './baseline/BaselineEditorPage';
import { BaselinePage } from './baseline/BaselinePage';
import { FieldSheetEditorPage } from './field/FieldSheetEditorPage';
import { FieldSheetsPage } from './field/FieldSheetsPage';
import { HouseholdsPage } from './households/HouseholdsPage';
import { StickerSheetPage } from './households/StickerSheetPage';
import { IncidentsPage } from './incidents/IncidentsPage';
import { LivePage } from './live/LivePage';
import { LoginPage } from './session/LoginPage';
import { RequireSession } from './session/RequireSession';
import { SessionProvider } from './session/SessionProvider';
import { TripDetailPage } from './trips/TripDetailPage';
import { TripsPage } from './trips/TripsPage';
import { PanelIndex } from './shell/PanelIndex';
import { PanelShell } from './shell/PanelShell';
import { RequirePermission } from './shell/RequirePermission';
import { UsersPage } from './users/UsersPage';

const FIELD_READ = ['field:read_own', 'field:read_all'] as const;

const renderFailure = (
  <div className="panel-failure" data-density="panel">
    <Notice tone="danger" title="No pudimos mostrar esta página">
      <p>Vuelve a cargar la página. Si el problema sigue, avisa al administrador.</p>
    </Notice>
  </div>
);

function NotFound() {
  return (
    <Notice tone="warn" title="Página no encontrada">
      <p>La dirección no corresponde a ninguna sección del panel. Elige una en el menú.</p>
    </Notice>
  );
}

/**
 * The municipal panel (`/panel/*`), loaded on demand: citizens never download it. Sign-in at
 * `/panel/ingresar`; every other page needs a session and is shown inside the shell.
 */
export default function PanelApp() {
  return (
    <ErrorBoundary fallback={renderFailure}>
      <SessionProvider>
        <Routes>
          <Route path="ingresar" element={<LoginPage />} />
          <Route
            element={
              <RequireSession>
                <PanelShell />
              </RequireSession>
            }
          >
            <Route index element={<PanelIndex />} />
            <Route
              path="en-vivo"
              element={
                <RequirePermission anyOf={['live:read']}>
                  <LivePage />
                </RequirePermission>
              }
            />
            <Route
              path="viajes"
              element={
                <RequirePermission anyOf={['trips:read']}>
                  <TripsPage />
                </RequirePermission>
              }
            />
            <Route
              path="viajes/:id"
              element={
                <RequirePermission anyOf={['trips:read']}>
                  <TripDetailPage />
                </RequirePermission>
              }
            />
            <Route
              path="incidencias"
              element={
                <RequirePermission anyOf={['incidents:read']}>
                  <IncidentsPage />
                </RequirePermission>
              }
            />
            <Route
              path="hogares"
              element={
                <RequirePermission anyOf={['households:read']}>
                  <HouseholdsPage />
                </RequirePermission>
              }
            />
            <Route
              path="hogares/stickers"
              element={
                <RequirePermission anyOf={['households:read']}>
                  <StickerSheetPage />
                </RequirePermission>
              }
            />
            <Route
              path="fichas"
              element={
                <RequirePermission anyOf={FIELD_READ}>
                  <FieldSheetsPage />
                </RequirePermission>
              }
            />
            <Route
              path="fichas/nueva"
              element={
                <RequirePermission anyOf={FIELD_READ}>
                  <FieldSheetEditorPage />
                </RequirePermission>
              }
            />
            <Route
              path="fichas/:id"
              element={
                <RequirePermission anyOf={FIELD_READ}>
                  <FieldSheetEditorPage />
                </RequirePermission>
              }
            />
            <Route
              path="linea-base"
              element={
                <RequirePermission anyOf={FIELD_READ}>
                  <BaselinePage />
                </RequirePermission>
              }
            />
            <Route
              path="linea-base/nuevo"
              element={
                <RequirePermission anyOf={FIELD_READ}>
                  <BaselineEditorPage />
                </RequirePermission>
              }
            />
            <Route
              path="linea-base/:id"
              element={
                <RequirePermission anyOf={FIELD_READ}>
                  <BaselineEditorPage />
                </RequirePermission>
              }
            />
            <Route
              path="usuarios"
              element={
                <RequirePermission anyOf={['users:manage']}>
                  <UsersPage />
                </RequirePermission>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </SessionProvider>
    </ErrorBoundary>
  );
}
