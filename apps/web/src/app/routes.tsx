import type { RouteObject } from 'react-router';
import { AuthLayout } from '../features/auth/AuthLayout';
import { ConfirmPage, RESET_PASSWORD_PATH } from '../features/auth/ConfirmPage';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage';
import { SignUpPage } from '../features/auth/SignUpPage';
import { RedirectIfSignedIn, RequireAuth } from '../features/auth/guards';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { NotFoundPage } from './NotFoundPage';
import { RootLayout } from './RootLayout';

/**
 * Route table, shared by the browser router (App.tsx) and the tests' memory router.
 * Everything under "/" needs a signed-in user (RequireAuth); only the auth screens are public.
 */
export const routes: RouteObject[] = [
  {
    // Signed-out only: a signed-in visitor is sent on to the app.
    element: <RedirectIfSignedIn />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'signup', element: <SignUpPage /> },
          { path: 'forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
    ],
  },
  {
    // Email links: they work whether or not someone is signed in on this device.
    element: <AuthLayout />,
    children: [
      { path: 'auth/confirm', element: <ConfirmPage /> },
      { path: RESET_PASSWORD_PATH.slice(1), element: <ResetPasswordPage /> },
    ],
  },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      {
        element: <RootLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
