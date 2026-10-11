import { lazy, Suspense } from 'react';

// The municipal panel is a separate chunk: the citizen page never downloads it.
const PanelApp = lazy(() => import('../panel/PanelApp'));

/** The panel, fetched the first time a `/panel` address is opened. */
export function LazyPanel() {
  return (
    <Suspense fallback={<p className="panel-loading">Cargando el panel…</p>}>
      <PanelApp />
    </Suspense>
  );
}
