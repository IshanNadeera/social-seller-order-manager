import { Link, Outlet, useLocation } from 'react-router';
import { FormAlert } from '../components/form';
import { PlusIcon } from '../components/icons';
import { useMe } from '../features/account/use-me';
import { LogOutButton } from '../features/auth/LogOutButton';
import type { NoticeState } from '../features/auth/ResetPasswordPage';
import { strings } from '../lib/strings';
import { DESKTOP_NAV, MOBILE_NAV, NAV_ITEMS } from './navigation';
import type { NavItem } from './navigation';

export const MAIN_CONTENT_ID = 'main-content';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

/**
 * Frame for every signed-in screen (docs/DEVELOPMENT.md §6.1, §6.9).
 * - Desktop (md and up): side navigation with "+ New order", the six sections and Log out.
 * - Mobile: a slim top bar, and a bottom bar with a raised "+ New order" in the centre.
 * Both navigations are in the page; CSS shows one of them, so only one is ever announced.
 */
export function RootLayout() {
  const location = useLocation();
  const { pathname } = location;
  // Router state is untyped; only the notice set by ResetPasswordPage is read from it.
  const notice = (location.state as NoticeState | null)?.notice;
  // Already loaded by RequireBusiness, so this reads the cache.
  const businessName = useMe().data?.business?.name ?? strings.appName;

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className={`sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-semibold focus:shadow ${focusRing}`}
      >
        {strings.shell.skipToContent}
      </a>

      <DesktopSidebar businessName={businessName} pathname={pathname} />

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur md:hidden">
        <p className="truncate px-4 py-3 font-semibold">{businessName}</p>
      </header>

      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        // Bottom padding keeps content clear of the mobile bar (and the iPhone home indicator).
        className="mx-auto max-w-5xl space-y-4 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] focus:outline-none md:ml-64 md:px-8 md:pb-10"
      >
        {notice === 'passwordChanged' && (
          <FormAlert tone="success">{strings.notices.passwordChanged}</FormAlert>
        )}
        <Outlet />
      </main>

      <MobileBottomNav pathname={pathname} />
    </div>
  );
}

function DesktopSidebar({ businessName, pathname }: { businessName: string; pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="space-y-1 px-5 pt-6 pb-4">
        <p className="truncate text-lg font-semibold">{businessName}</p>
        <p className="text-xs text-slate-500">{strings.appName}</p>
      </div>
      <div className="px-4 pb-4">
        <Link
          to={NAV_ITEMS.newOrder.path}
          aria-current={NAV_ITEMS.newOrder.isActive(pathname) ? 'page' : undefined}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white hover:bg-blue-800 ${focusRing}`}
        >
          <PlusIcon className="size-5" />
          {strings.nav.newOrder}
        </Link>
      </div>
      <nav aria-label={strings.shell.mainNav} className="flex-1 overflow-y-auto px-3">
        <ul className="space-y-1">
          {DESKTOP_NAV.map((item) => (
            <li key={item.key}>
              <SidebarLink item={item} active={item.isActive(pathname)} />
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t border-slate-200 p-4">
        <LogOutButton />
      </div>
    </aside>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const { Icon } = item;
  return (
    <Link
      to={item.path}
      aria-current={active ? 'page' : undefined}
      className={[
        'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 font-medium',
        active ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-100',
        focusRing,
      ].join(' ')}
    >
      <Icon className="size-5 shrink-0" />
      {item.label}
    </Link>
  );
}

function MobileBottomNav({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label={strings.shell.mainNav}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5 items-end">
        {MOBILE_NAV.map((item) => (
          <li key={item.key} className="flex justify-center">
            {item.key === 'newOrder' ? (
              <NewOrderTab item={item} active={item.isActive(pathname)} />
            ) : (
              <BottomTab item={item} active={item.isActive(pathname)} />
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function BottomTab({ item, active }: { item: NavItem; active: boolean }) {
  const { Icon } = item;
  return (
    <Link
      to={item.path}
      aria-current={active ? 'page' : undefined}
      className={[
        'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-xs font-medium',
        active ? 'text-blue-800' : 'text-slate-600',
        focusRing,
      ].join(' ')}
    >
      <Icon className="size-6" />
      <span className={active ? 'font-semibold' : undefined}>{item.label}</span>
    </Link>
  );
}

/** The prominent centre button: raised above the bar, larger, in the brand colour (§6.1). */
function NewOrderTab({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.path}
      aria-current={active ? 'page' : undefined}
      className={`-mt-6 flex flex-col items-center gap-0.5 pb-1.5 text-xs font-semibold text-blue-800 ${focusRing} rounded-lg`}
    >
      <span className="grid size-14 place-items-center rounded-full bg-blue-700 text-white shadow-lg ring-4 ring-white">
        <PlusIcon className="size-7" />
      </span>
      <span>{item.label}</span>
    </Link>
  );
}
