import { strings } from '../../lib/strings';

/** Placeholder. The real dashboard is built in E2 (docs/DEVELOPMENT.md §6.2). */
export function DashboardPage() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{strings.dashboard.title}</h1>
      <p className="text-slate-600">{strings.dashboard.empty}</p>
    </section>
  );
}
