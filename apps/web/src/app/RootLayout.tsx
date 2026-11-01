import { Outlet, useLocation } from 'react-router';
import { FormAlert } from '../components/form';
import { useMe } from '../features/account/use-me';
import { LogOutButton } from '../features/auth/LogOutButton';
import type { NoticeState } from '../features/auth/ResetPasswordPage';
import { strings } from '../lib/strings';

/**
 * Minimal page frame for signed-in screens with a business. Task A21 replaces the header with the
 * side navigation and mobile bottom bar; the log-out button moves there.
 */
export function RootLayout() {
  const location = useLocation();
  const notice = (location.state as NoticeState | null)?.notice;
  // Already loaded by RequireBusiness, so this reads the cache.
  const businessName = useMe().data?.business?.name;

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">{businessName ?? strings.appName}</p>
            {businessName && <p className="text-xs text-slate-500">{strings.appName}</p>}
          </div>
          <LogOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        {notice === 'passwordChanged' && (
          <FormAlert tone="success">{strings.notices.passwordChanged}</FormAlert>
        )}
        <Outlet />
      </main>
    </div>
  );
}
