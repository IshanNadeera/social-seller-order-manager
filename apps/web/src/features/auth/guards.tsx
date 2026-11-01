import { Navigate, Outlet, useLocation } from 'react-router';
import { FullPageStatus } from '../../components/FullPageStatus';
import { strings } from '../../lib/strings';
import { useAuth } from './AuthProvider';
import { LOGIN_PATH, safeReturnPath } from './redirect';
import type { LoginState } from './redirect';

/**
 * Layout route for everything that needs a signed-in user. Signed-out visitors go to /login,
 * which brings them back here afterwards. This is a convenience only: the API checks the token
 * on every request (§11.2), so hiding a page is never the protection.
 */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageStatus message={strings.common.loading} />;
  if (status === 'signedOut') {
    const state: LoginState = {
      from: { pathname: location.pathname, search: location.search, hash: location.hash },
    };
    return <Navigate to={LOGIN_PATH} replace state={state} />;
  }
  return <Outlet />;
}

/** Layout route for log in, sign up and forgot password: signed-in users skip straight past them. */
export function RedirectIfSignedIn() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageStatus message={strings.common.loading} />;
  if (status === 'signedIn') {
    const from = (location.state as LoginState | null)?.from;
    return <Navigate to={safeReturnPath(from)} replace />;
  }
  return <Outlet />;
}
