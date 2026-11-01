import { Outlet } from 'react-router';
import { strings } from '../../lib/strings';

/** Frame for the signed-out screens: one narrow card, comfortable at 360 px wide (§6.9). */
export function AuthLayout() {
  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto w-full max-w-sm space-y-6">
        <p className="text-center text-sm font-semibold tracking-wide text-slate-600">
          {strings.appName}
        </p>
        <main className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
