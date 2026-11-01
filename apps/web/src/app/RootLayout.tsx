import { Outlet } from 'react-router';

/** Minimal page frame. Task A21 replaces it with the side navigation and mobile bottom bar. */
export function RootLayout() {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
