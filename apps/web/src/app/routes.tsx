import type { RouteObject } from 'react-router';
import { ONBOARDING_PATH, RequireBusiness } from '../features/account/AccountGate';
import { AuthLayout } from '../features/auth/AuthLayout';
import { ConfirmPage, RESET_PASSWORD_PATH } from '../features/auth/ConfirmPage';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage';
import { SignUpPage } from '../features/auth/SignUpPage';
import { RedirectIfSignedIn, RequireAuth } from '../features/auth/guards';
import { CustomerDetailPage } from '../features/customers/CustomerDetailPage';
import { CustomerCreatePage, CustomerEditPage } from '../features/customers/CustomerFormPages';
import { CustomersListPage } from '../features/customers/CustomersListPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { OnboardingPage } from '../features/onboarding/OnboardingPage';
import { OrderCreatePage } from '../features/orders/OrderCreatePage';
import { OrdersListPage } from '../features/orders/OrdersListPage';
import { ProductCreatePage, ProductEditPage } from '../features/products/ProductFormPages';
import { ProductsListPage } from '../features/products/ProductsListPage';
import { strings } from '../lib/strings';
import { MorePage } from './MorePage';
import { NotFoundPage } from './NotFoundPage';
import { PlaceholderPage } from './PlaceholderPage';
import { RootLayout } from './RootLayout';

/**
 * Route table, shared by the browser router (App.tsx) and the tests' memory router.
 * Everything under "/" needs a signed-in user (RequireAuth); only the auth screens are public.
 * The app itself also needs a business (RequireBusiness); until then the user is sent to /onboarding.
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
      { path: ONBOARDING_PATH.slice(1), element: <OnboardingPage /> },
      {
        element: <RequireBusiness />,
        children: [
          {
            element: <RootLayout />,
            children: [
              { index: true, element: <DashboardPage /> },
              // Placeholders until their tasks land (orders C15, reports E3,
              // settings E5), so every navigation link leads somewhere.
              { path: 'orders', element: <OrdersListPage /> },
              { path: 'orders/new', element: <OrderCreatePage /> },
              // Where a saved order lands until the order details page (C15) replaces it.
              {
                path: 'orders/:orderId',
                element: <PlaceholderPage title={strings.orders.detailTitle} />,
              },
              { path: 'customers', element: <CustomersListPage /> },
              { path: 'customers/new', element: <CustomerCreatePage /> },
              { path: 'customers/:customerId', element: <CustomerDetailPage /> },
              { path: 'customers/:customerId/edit', element: <CustomerEditPage /> },
              { path: 'products', element: <ProductsListPage /> },
              { path: 'products/new', element: <ProductCreatePage /> },
              { path: 'products/:productId', element: <ProductEditPage /> },
              { path: 'reports', element: <PlaceholderPage title={strings.nav.reports} /> },
              { path: 'settings', element: <PlaceholderPage title={strings.nav.settings} /> },
              { path: 'more', element: <MorePage /> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
];
