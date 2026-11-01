import { Link } from 'react-router';
import { ChevronRightIcon } from '../components/icons';
import { LogOutButton } from '../features/auth/LogOutButton';
import { strings } from '../lib/strings';
import { MORE_NAV } from './navigation';

/** Mobile "More" (§6.1): the sections that don't fit in the bottom bar, and Log out. */
export function MorePage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{strings.nav.more}</h1>
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {MORE_NAV.map(({ key, path, label, Icon }) => (
          <li key={key}>
            <Link
              to={path}
              className="flex min-h-12 items-center gap-3 px-4 py-3 font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-700"
            >
              <Icon className="size-5 shrink-0 text-slate-500" />
              <span className="flex-1">{label}</span>
              <ChevronRightIcon className="size-5 text-slate-400" />
            </Link>
          </li>
        ))}
      </ul>
      <LogOutButton />
    </section>
  );
}
