import type { MeResponse } from '@ssom/shared';
import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { FullPageStatus } from '../../components/FullPageStatus';
import { strings } from '../../lib/strings';
import { LogOutButton } from '../auth/LogOutButton';
import { useMe } from './use-me';

export const ONBOARDING_PATH = '/onboarding';

/**
 * Loads GET /me and shows a loading or error screen until it arrives; then renders `children(me)`.
 * Used by RequireBusiness and the onboarding page.
 */
export function WithMe({ children }: { children: (me: MeResponse) => ReactNode }) {
  const me = useMe();
  if (me.isPending) return <FullPageStatus message={strings.common.loading} />;
  if (me.isError) {
    return (
      <AccountLoadError error={me.error} retrying={me.isFetching} onRetry={() => void me.refetch()} />
    );
  }
  return <>{children(me.data)}</>;
}

/**
 * Layout route for the app itself: a user without a business is sent to onboarding first (§9.1).
 * As with RequireAuth, this guides the UI; the API enforces membership on every request (§11.2).
 */
export function RequireBusiness() {
  return (
    <WithMe>
      {(me) => (me.needsOnboarding ? <Navigate to={ONBOARDING_PATH} replace /> : <Outlet />)}
    </WithMe>
  );
}

function AccountLoadError({
  error,
  retrying,
  onRetry,
}: {
  error: unknown;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 px-4">
      <section className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold">{strings.account.loadFailedTitle}</h1>
        <div role="alert" className="text-slate-700">
          <ApiErrorMessage error={error} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-70"
          >
            {retrying ? strings.account.retrying : strings.account.retry}
          </button>
          <LogOutButton />
        </div>
      </section>
    </div>
  );
}
