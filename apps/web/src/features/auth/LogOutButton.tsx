import { useState } from 'react';
import { strings } from '../../lib/strings';
import { useAuth } from './AuthProvider';

/**
 * Ends the session on this device and revokes its refresh token (US-002). Other devices stay signed
 * in; "sign out of all devices" belongs to Settings (E5). The auth state change then sends the
 * seller to /login, and AuthProvider clears cached data.
 */
export function LogOutButton() {
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
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-70"
      >
        {pending ? strings.layout.loggingOut : strings.layout.logOut}
      </button>
    </div>
  );
}
