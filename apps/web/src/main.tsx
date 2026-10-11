import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { appRoutes } from './app/routes';
import { registerServiceWorker } from './register-service-worker';
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import './shared/styles/tokens.css';
import './shared/styles/global.css';
import './shared/ui/ui.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

const router = createBrowserRouter(appRoutes);

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

registerServiceWorker();
