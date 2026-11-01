import { useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { FormAlert } from '../components/form';
import { useAuth } from '../features/auth/AuthProvider';
import type { NoticeState } from '../features/auth/ResetPasswordPage';
import { strings } from '../lib/strings';

/**
 * Minimal page frame for signed-in screens. Task A21 replaces the header with the side navigation
 * and mobile bottom bar; the log-out button moves there.
 */
export function RootLayout() {
  const location = useLocation();
  const notice = (location.state as NoticeState | null)?.notice;

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <p className="font-semibold">{strings.appName}</p>
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

/**
 * Ends the session on this device and revokes its refresh token (US-002). Other devices stay signed
 * in; "sign out of all devices" belongs to Settings (E5). The auth state change then sends the
 * seller to /login, and AuthProvider clears cached data.
 */
function LogOutButton() {
  const { client } = useAuth();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const logOut = async () => {
    setPending(true);
    setFailed(false);
    try {
      const { error } = await client.signOut({ scope: 'local' });
      if (error) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {failed && (
        <p role="alert" className="text-sm text-red-700">
          {strings.layout.logOutFailed}
        </p>
      )}
      <button
        type="button"
        onClick={() => void logOut()}
        disabled={pending}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-70"
      >
        {pending ? strings.layout.loggingOut : strings.layout.logOut}
      </button>
    </div>
  );
}
