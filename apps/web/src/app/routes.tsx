import type { RouteObject } from 'react-router';

import { CitizenHomePage } from '../citizen/CitizenHomePage';
import { PanelHomePage } from '../panel/PanelHomePage';

/** Route table shared by the browser router and the tests. */
export const appRoutes: RouteObject[] = [
  { path: '/', element: <CitizenHomePage /> },
  { path: '/panel', element: <PanelHomePage /> },
];
