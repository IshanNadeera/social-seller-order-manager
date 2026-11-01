import type { RouteObject } from 'react-router';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { NotFoundPage } from './NotFoundPage';
import { RootLayout } from './RootLayout';

/** Route table, shared by the browser router (App.tsx) and the tests' memory router. */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
