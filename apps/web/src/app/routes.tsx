import type { RouteObject } from 'react-router';

import { CitizenErrorPage } from '../citizen/CitizenErrorPage';
import { CitizenHomePage } from '../citizen/CitizenHomePage';
import { LazyPanel } from './LazyPanel';

/** Route table shared by the browser router and the tests. */
export const appRoutes: RouteObject[] = [
  // A render error shows a calm Spanish page instead of unmounting everything.
  { path: '/', element: <CitizenHomePage />, errorElement: <CitizenErrorPage /> },
  { path: '/panel/*', element: <LazyPanel /> },
];
