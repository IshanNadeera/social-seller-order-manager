// Figure tiles shared by the dashboard and the reports (docs/DEVELOPMENT.md §6.2): each figure has
// its own labelled tile, so different kinds of money are never read as one number.
import { useId } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { linkClass } from '../../components/form';
import { strings } from '../../lib/strings';

const s = strings.dashboard;

/** One group of tiles, named by its heading (a landmark screen readers can jump to). */
export function Group({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {title}
        {note !== undefined && (
          <span className="ml-2 text-sm font-normal text-slate-600">{note}</span>
        )}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</dl>
    </section>
  );
}

/** One figure: its label, the value, and an optional explanation and link. */
export function Tile({
  label,
  value,
  hint,
  to,
}: {
  label: string;
  value: string;
  hint?: string;
  to?: string;
}) {
  return (
    <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-4">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-2xl font-semibold text-slate-900">{value}</dd>
      {hint !== undefined && <dd className="text-sm text-slate-600">{hint}</dd>}
      {to !== undefined && (
        <dd>
          <Link to={to} className={`${linkClass} text-sm`}>
            {s.tiles.open(label)}
          </Link>
        </dd>
      )}
    </div>
  );
}
